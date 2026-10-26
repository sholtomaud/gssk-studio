import { beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { defaultForcing, evaluateForcing } from '../../src/model/forcing.ts';
import { canonicalJson, toKernelModel } from '../../src/model/kernel-json.ts';
import { cloneModel, WAVEFORMS, type Forcing, type StudioModel } from '../../src/model/types.ts';
import { validate } from '../../src/model/validate.ts';
import { EnsembleError, ensembleModel } from '../../src/sim/ensemble.ts';
import type { GsskKernel } from '../../src/sim/gssk.ts';
import { runModel } from '../../src/sim/run.ts';
import { loadKernel } from './helpers.ts';

let kernel: GsskKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

const seasonal = () => cloneModel(EXAMPLES.find((e) => e.id === 'seasonal')!.model);

/** A two-node model whose only flow carries `forcing`. */
function withEdgeForcing(forcing: Forcing): StudioModel {
  const m = seasonal();
  m.edges[1]!.forcing = forcing;
  return m;
}

describe('forcing functions (FR-FRC-001)', () => {
  const cases: Forcing[] = [
    { waveform: 'step', t_on: 10, v0: 0.1, v1: 0.4 },
    { waveform: 'ramp', t_on: 5, v0: 0.1, slope: 0.01 },
    { waveform: 'exponential', t_on: 2, v0: 0.05, rate: 0.03 },
    { waveform: 'sine', mean: 0.2, amplitude: 0.1, period: 7, phase: 1.5, t_on: 3 },
    { waveform: 'square', mean: 0.2, amplitude: 0.1, period: 6, duty: 0.3 },
    { waveform: 'sawtooth', mean: 0.2, amplitude: 0.1, period: 5, phase: -1 },
    { waveform: 'sine', mean: 0.2, amplitude: 0.3, period: 9, min: 0, max: 0.4 },
    { waveform: 'impulse', t_on: 10, area: 2 },
    {
      waveform: 'table',
      times: [4, 10, 20],
      values: [0.1, 0.5, 0.2],
      interpolation: 'linear',
      extrapolation: 'hold',
    },
    { waveform: 'table', times: [4, 10, 20], values: [0.1, 0.5, 0.2], interpolation: 'step' },
    {
      waveform: 'table',
      times: [4, 10, 20],
      values: [0.1, 0.5, 0.2],
      interpolation: 'linear',
      extrapolation: 'cycle',
    },
  ];
  for (const f of cases) {
    it(`the preview of ${JSON.stringify(f)} is the kernel's own value`, () => {
      const m = withEdgeForcing(f);
      const inst = kernel.init(canonicalJson(toKernelModel(m)));
      try {
        for (let t = 0; t <= 48; t += 0.37) {
          // Stay off the exact switching instants, where either side is right.
          expect(evaluateForcing(f, t, m.config), `t=${t}`).toBeCloseTo(
            inst.edgeForcingAt('drainage', t),
            9
          );
        }
      } finally {
        inst.free();
      }
    });
  }

  it('drives a source node: the preview matches the kernel', () => {
    const m = seasonal();
    const inst = kernel.init(canonicalJson(toKernelModel(m)));
    for (const t of [0, 1, 2.5, 6, 11.9]) {
      expect(evaluateForcing(m.nodes[0]!.forcing!, t, m.config)).toBeCloseTo(
        inst.nodeForcingAt('rain', t),
        9
      );
    }
    inst.free();
  });

  it('every default waveform passes the checks and loads on the kernel', () => {
    for (const w of WAVEFORMS) {
      const m = seasonal();
      m.nodes[0]!.forcing = defaultForcing(w, 10, m.config);
      m.edges[1]!.forcing = defaultForcing(w, 0.08, m.config);
      expect(validate(m), w).toEqual([]);
      kernel.init(canonicalJson(toKernelModel(m))).free();
    }
  });

  it('changes the run: forced rain makes the wetland rise and fall', async () => {
    const forced = await runModel(kernel, seasonal());
    const flat = seasonal();
    delete flat.nodes[0]!.forcing;
    delete flat.edges[2]!.forcing;
    const plain = await runModel(kernel, flat);
    const wet = (r: typeof forced) => r.nodes.find((n) => n.id === 'wetland')!.values;
    let turns = 0;
    const w = wet(forced);
    for (let i = 2; i < w.length; i++)
      if (Math.sign(w[i]! - w[i - 1]!) !== Math.sign(w[i - 1]! - w[i - 2]!)) turns++;
    expect(turns).toBeGreaterThanOrEqual(4);
    // A forced source's state is its forced value, so playback and the chart show the wave.
    const rain = forced.nodes.find((n) => n.id === 'rain')!.values;
    expect(Math.max(...rain)).toBeCloseTo(18, 1);
    expect(Math.min(...rain)).toBeCloseTo(2, 1);
    expect(forced.final.wetland).not.toBeCloseTo(plain.final.wetland!, 1);
  });

  it('the kernel refuses a forced storage, as the checks say', () => {
    const m = seasonal();
    m.nodes[1]!.forcing = { waveform: 'step', v0: 1, v1: 2 };
    expect(validate(m).map((i) => i.code)).toContain('forcing-node');
    expect(() => kernel.init(canonicalJson(toKernelModel(m)))).toThrow(/SCHEMA_VIOLATION/);
  });

  it('the kernel refuses a periodic wave with no period, as the checks say', () => {
    const m = withEdgeForcing({ waveform: 'sine', mean: 1, amplitude: 1 });
    expect(validate(m).map((i) => i.code)).toContain('forcing');
    expect(() => kernel.init(canonicalJson(toKernelModel(m)))).toThrow(/SCHEMA_VIOLATION/);
  });
});

describe('ensembles (FR-ENS-001)', () => {
  const opts = { runs: 40, perturbation: 0.2, seed: '42' };

  it('brackets every series: min ≤ mean ≤ max, and the run inside a wide enough band', async () => {
    const m = cloneModel(EXAMPLES.find((e) => e.id === 'reservoir')!.model);
    const run = await runModel(kernel, m);
    const ens = await ensembleModel(kernel, m, opts);
    expect(ens.manifest.seed).toBe('42');
    expect(ens.manifest.modelHash).toBe(run.manifest.modelHash);
    expect(Array.from(ens.times)).toEqual(Array.from(run.times));
    const r = ens.nodes.find((n) => n.id === 'reservoir')!;
    const base = run.nodes.find((n) => n.id === 'reservoir')!.values;
    for (let i = 0; i < r.mean.length; i++) {
      expect(r.min[i]!).toBeLessThanOrEqual(r.mean[i]! + 1e-12);
      expect(r.mean[i]!).toBeLessThanOrEqual(r.max[i]! + 1e-12);
    }
    // Step 0 is every run's initial state.
    expect(r.min[0]).toBe(50);
    expect(r.max[0]).toBe(50);
    const last = r.mean.length - 1;
    expect(r.max[last]! - r.min[last]!).toBeGreaterThan(1);
    expect(base[last]!).toBeGreaterThan(r.min[last]!);
    expect(base[last]!).toBeLessThan(r.max[last]!);
  });

  it('is reproducible for a seed and differs for another', async () => {
    const m = EXAMPLES.find((e) => e.id === 'household')!.model;
    const a = await ensembleModel(kernel, m, opts);
    const b = await ensembleModel(kernel, m, opts);
    const c = await ensembleModel(kernel, m, { ...opts, seed: '43' });
    const bank = (e: typeof a) => Array.from(e.nodes.find((n) => n.id === 'bank')!.max);
    expect(bank(a)).toEqual(bank(b));
    expect(bank(c)).not.toEqual(bank(a));
  });

  it('charts a composite by its body, like a run', async () => {
    const m = EXAMPLES.find((e) => e.id === 'grassland')!.model;
    const ens = await ensembleModel(kernel, m, { ...opts, runs: 5 });
    expect(ens.nodes.find((n) => n.id === 'grass')!.mean[0]).toBe(20);
  });

  it('refuses options it cannot honour, in words', async () => {
    const m = EXAMPLES[3]!.model;
    for (const bad of [
      { ...opts, runs: 1 },
      { ...opts, runs: 501 },
      { ...opts, perturbation: 0 },
      { ...opts, perturbation: 1 },
      { ...opts, seed: '-1' },
      { ...opts, seed: '18446744073709551616' },
    ]) {
      await expect(ensembleModel(kernel, m, bad)).rejects.toBeInstanceOf(EnsembleError);
    }
    const huge = cloneModel(m);
    huge.config.dt = 0.00002;
    await expect(ensembleModel(kernel, huge, opts)).rejects.toThrow(/too large an envelope/);
  });
});
