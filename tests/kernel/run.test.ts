import { beforeAll, describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../src/model/catalogue.ts';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { cloneModel, type StudioModel } from '../../src/model/types.ts';
import type { GsskKernel } from '../../src/sim/gssk.ts';
import { MAX_SAMPLES, RunSession, runModel, sampleAt } from '../../src/sim/run.ts';
import { loadKernel } from './helpers.ts';

let kernel: GsskKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

const round = (v: number) => Number(v.toPrecision(8));

describe('running models (FR-SIM-001)', () => {
  for (const ex of EXAMPLES) {
    it(`runs the ${ex.id} example cleanly and reproducibly`, async () => {
      const a = await runModel(kernel, ex.model);
      const b = await runModel(kernel, ex.model);
      expect(a.diagnostics.solverConfident).toBe(true);
      expect(a.manifest.modelHash).toBe(b.manifest.modelHash);
      expect(a.final).toEqual(b.final);
      expect(a.nodes.map((n) => n.id)).toEqual(ex.model.nodes.map((n) => n.id));
      expect(a.times[0]).toBe(ex.model.config.t_start);
      expect(a.times.at(-1)).toBeCloseTo(ex.model.config.t_end, 9);
      expect(a.times.length).toBeLessThanOrEqual(MAX_SAMPLES + 1);
      expect(
        Object.fromEntries(Object.entries(a.final).map(([k, v]) => [k, round(v)]))
      ).toMatchSnapshot();
    });
  }

  it('charts a composite by its body, not its gate or heat member', async () => {
    const r = await runModel(kernel, EXAMPLES[0]!.model);
    const grass = r.nodes.find((n) => n.id === 'grass');
    expect(grass?.holdsState).toBe(true);
    // The body starts at the declared value; the other members start at zero.
    expect(grass?.values[0]).toBe(20);
  });

  it('runs every palette symbol on the kernel, natively', async () => {
    for (const spec of CATALOGUE) {
      const m: StudioModel = {
        metadata: { schema_version: 4, name: `type:${spec.type}` },
        config: { t_start: 0, t_end: 10, dt: 0.1, method: 'rk4' },
        nodes: [
          { id: 'sun', type: 'source', value: 100, visual: { x: 0, y: 0 } },
          { id: 'x', type: spec.type, value: 5, visual: { x: 0, y: 0 } },
          { id: 's', type: 'storage', value: 1, visual: { x: 0, y: 0 } },
          { id: 'heat', type: 'sink', value: 0, visual: { x: 0, y: 0 } },
        ],
        edges: [
          { id: 'a', origin: 'sun', target: 'x', logic: 'linear', params: { k: 0.1 } },
          { id: 'b', origin: 'x', target: 's', logic: 'linear', params: { k: 0.1 } },
          {
            id: 'c',
            origin: 's',
            target: 'heat',
            logic: 'linear',
            params: { k: 0.05, control_node: 'x' },
          },
        ],
        _diagram: { boundaries: [] },
      };
      m.edges[2]!.logic = 'interaction';
      const r = await runModel(kernel, m);
      expect(
        r.nodes.map((n) => n.id),
        spec.type
      ).toEqual(['sun', 'x', 's', 'heat']);
      expect(Number.isFinite(r.final.s), spec.type).toBe(true);
    }
  });

  it('records flows per edge, signed, refreshed each step', async () => {
    const r = await runModel(kernel, EXAMPLES[3]!.model);
    const pay = r.flows.find((f) => f.id === 'pay');
    expect(pay?.sensed).toBe(false);
    expect(pay?.values[0]).toBe(0);
    expect(pay?.values.at(-1)).toBeCloseTo(70, 6);
  });

  it('marks the flows that carry a sensor, without changing the run (FR-EDIT-010)', async () => {
    const m = cloneModel(EXAMPLES[3]!.model);
    m.edges[0]!.visual = { sensor: true };
    const r = await runModel(kernel, m);
    expect(r.flows.filter((f) => f.sensed).map((f) => f.id)).toEqual([m.edges[0]!.id]);
    const plain = await runModel(kernel, EXAMPLES[3]!.model);
    expect(r.manifest.modelHash).toBe(plain.manifest.modelHash);
    expect(r.final).toEqual(plain.final);
  });

  it('reports a kernel refusal as an error, not a result', async () => {
    const m = cloneModel(EXAMPLES[0]!.model);
    m.edges[0]!.target = 'ghost';
    await expect(runModel(kernel, m)).rejects.toThrow(/GSSK_Init/);
  });

  it('gives the same run in chunks as in one go, and can be closed mid-run (FR-SIM-005)', async () => {
    const model = EXAMPLES[1]!.model;
    const whole = await runModel(kernel, model);
    const session = await RunSession.start(kernel, model);
    let chunks = 0;
    while (!session.done) {
      session.advance(0); // one 64-step slice per call
      chunks++;
    }
    expect(chunks).toBe(Math.ceil(session.steps / 64));
    const chunked = session.result();
    expect(chunked.final).toEqual(whole.final);
    expect(Array.from(chunked.times)).toEqual(Array.from(whole.times));
    expect(chunked.manifest.modelHash).toBe(whole.manifest.modelHash);

    const cancelled = await RunSession.start(kernel, model);
    cancelled.advance(0);
    cancelled.close();
    cancelled.close();
    expect(() => cancelled.advance()).toThrow(/closed/);
  });

  it('finds the nearest sample', () => {
    const t = new Float64Array([0, 1, 2, 3]);
    expect(sampleAt(t, 1.4)).toBe(1);
    expect(sampleAt(t, 1.6)).toBe(2);
    expect(sampleAt(t, 99)).toBe(3);
  });
});
