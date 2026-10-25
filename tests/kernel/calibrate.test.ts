import { beforeAll, describe, expect, it } from 'vitest';
import { CalibrationError, CalibrationSession, trajectories } from '../../src/fit/calibrate.ts';
import { interpolate } from '../../src/fit/stats.ts';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { cloneModel, type StudioModel } from '../../src/model/types.ts';
import type { GsskKernel } from '../../src/sim/gssk.ts';
import { loadKernel } from './helpers.ts';

let kernel: GsskKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

/** The reservoir example observed exactly at 11 times, then its rates knocked off by 50 %. */
function setup(): { model: StudioModel; truth: number[] } {
  const truthModel = cloneModel(EXAMPLES[2]!.model);
  delete truthModel._observations;
  const run = trajectories(kernel, truthModel, ['reservoir', 'town']);
  const ts = Array.from({ length: 11 }, (_, i) => i * 10);
  const at = (id: string) => ts.map((t) => interpolate(run.times, run.series.get(id)!, t));
  const model = cloneModel(truthModel);
  model._observations = [
    { id: 'r', name: 'reservoir', target: 'reservoir', times: ts, values: at('reservoir') },
    { id: 't', name: 'town', target: 'town', times: ts, values: at('town') },
  ];
  const truth = ['runoff', 'release'].map((id) => model.edges.find((e) => e.id === id)!.params.k);
  for (const id of ['runoff', 'release']) model.edges.find((e) => e.id === id)!.params.k *= 1.5;
  return { model, truth };
}

describe('calibration on the kernel (FR-CAL-001)', () => {
  it('recovers the rates that produced the observations', () => {
    const { model, truth } = setup();
    const cal = new CalibrationSession(kernel, model, ['runoff', 'release']);
    while (!cal.done) cal.advance(0);
    const r = cal.result();
    expect(r.stop).toBe('converged');
    r.rates.forEach((rate, i) => {
      expect(rate.after / truth[i]!).toBeCloseTo(1, 3);
      expect(rate.informed).toBe(true);
    });
    expect(r.sseAfter).toBeLessThan(r.sseBefore * 1e-6);
    expect(r.fits[0]!.after.nse).toBeGreaterThan(0.9999);
    expect(r.fits[0]!.before.nse).toBeLessThan(r.fits[0]!.after.nse);
    // The input model is untouched; the result carries the new rates.
    expect(model.edges.find((e) => e.id === 'runoff')!.params.k).toBeCloseTo(truth[0]! * 1.5, 12);
    expect(r.model.edges.find((e) => e.id === 'runoff')!.params.k).toBe(r.rates[0]!.after);
  });

  it('is deterministic', () => {
    const go = () => {
      const cal = new CalibrationSession(kernel, setup().model, ['runoff'], 5);
      while (!cal.done) cal.advance(0);
      const { model: _m, ...rest } = cal.result();
      return rest;
    };
    expect(go()).toEqual(go());
  });

  it('flags a rate the observations do not inform', () => {
    const { model } = setup();
    // Only the town is observed; the downstream release still moves it through the reservoir,
    // but a flow into a sink the model never reads back is invisible: add one.
    model.nodes.push({ id: 'spill', type: 'sink', value: 0, visual: { x: 0, y: 0 } });
    model.edges.push({
      id: 'evap',
      origin: 'rain',
      target: 'spill',
      logic: 'linear',
      params: { k: 0.1 },
    });
    const cal = new CalibrationSession(kernel, model, ['runoff', 'evap'], 10);
    while (!cal.done) cal.advance(0);
    const evap = cal.result().rates.find((r) => r.edgeId === 'evap')!;
    expect(evap.informed).toBe(false);
    expect(evap.after).toBeCloseTo(0.1, 12);
  });

  it('says what is missing before it starts', () => {
    const plain = cloneModel(EXAMPLES[1]!.model);
    expect(() => new CalibrationSession(kernel, plain, ['births'])).toThrow(CalibrationError);
    const { model } = setup();
    expect(() => new CalibrationSession(kernel, model, [])).toThrow(/at least one rate/);
    model.edges[0]!.params.k = 0;
    expect(() => new CalibrationSession(kernel, model, [model.edges[0]!.id])).toThrow(/positive/);
  });
});

describe('sensitivity (FR-SEN-001)', () => {
  it('gives the textbook elasticities for a linear store', async () => {
    const { elasticities } = await import('../../src/fit/sensitivity.ts');
    // Source S → storage Q → sink, linear: at steady state Q = k_in·S / k_out,
    // so the final level has elasticity +1 to k_in and −1 to k_out.
    const model: StudioModel = {
      metadata: { schema_version: 4, name: 'sens' },
      config: { t_start: 0, t_end: 400, dt: 0.1, method: 'rk4' },
      nodes: [
        { id: 's', type: 'source', value: 10, visual: { x: 0, y: 0 } },
        { id: 'q', type: 'storage', value: 0, visual: { x: 0, y: 0 } },
        { id: 'z', type: 'sink', value: 0, visual: { x: 0, y: 0 } },
      ],
      edges: [
        { id: 'in', origin: 's', target: 'q', logic: 'linear', params: { k: 0.5 } },
        { id: 'out', origin: 'q', target: 'z', logic: 'linear', params: { k: 0.1 } },
      ],
      _diagram: { boundaries: [] },
    };
    const e = elasticities(kernel, model, ['q']);
    expect(e.find((x) => x.edgeId === 'in')!.final).toBeCloseTo(1, 3);
    expect(e.find((x) => x.edgeId === 'out')!.final).toBeCloseTo(-1, 2);
  });
});
