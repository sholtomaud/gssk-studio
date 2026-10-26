import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import {
  describeForcing,
  evaluateForcing,
  forcingProblems,
  parseForcing,
} from '../../src/model/forcing.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { toKernelModel } from '../../src/model/kernel-json.ts';
import { cloneModel, DEFAULT_CONFIG } from '../../src/model/types.ts';
import { validate } from '../../src/model/validate.ts';

const seasonal = () => cloneModel(EXAMPLES.find((e) => e.id === 'seasonal')!.model);

describe('forcing in the model (FR-FRC-001)', () => {
  it('round-trips through a file and reaches the kernel JSON as written', () => {
    const m = seasonal();
    const back = parseModel(serialiseModel(m));
    expect(back.notes).toEqual([]);
    expect(back.model.nodes[0]!.forcing).toEqual(m.nodes[0]!.forcing);
    expect(back.model.edges[2]!.forcing).toEqual(m.edges[2]!.forcing);
    const k = toKernelModel(m);
    expect(k.nodes[0]!.forcing).toEqual(m.nodes[0]!.forcing);
    expect(k.edges[2]!.forcing).toEqual(m.edges[2]!.forcing);
    expect('forcing' in k.nodes[1]!).toBe(false);
  });

  it('keeps only what the kernel schema knows, and notes a block it cannot read', () => {
    expect(parseForcing({ waveform: 'sine', mean: 1, period: '7', colour: 'red' })).toEqual({
      waveform: 'sine',
      mean: 1,
    });
    expect(parseForcing({ waveform: 'wobble' })).toBeUndefined();
    const m = seasonal() as unknown as { nodes: { forcing?: unknown }[] };
    m.nodes[0]!.forcing = { waveform: 'wobble' };
    const r = parseModel(JSON.stringify(m));
    expect(r.model.nodes[0]!.forcing).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/forcing was not understood/);
  });

  it('names the shapes the kernel would refuse', () => {
    expect(forcingProblems({ waveform: 'square', mean: 1, amplitude: 1, period: 0 })).toEqual([
      'a square forcing needs a positive period',
    ]);
    expect(forcingProblems({ waveform: 'table', times: [0, 2, 2], values: [1, 2, 3] })).toEqual([
      'table times must be strictly increasing',
    ]);
    expect(forcingProblems({ waveform: 'table', times: [0, 1], values: [1] })).toEqual([
      'a table forcing needs one value per time',
    ]);
    expect(forcingProblems({ waveform: 'step', min: 2, max: 1 })).toEqual([
      'the lower clamp is above the upper clamp',
    ]);
  });

  it('flags a forced storage and points at it', () => {
    const m = seasonal();
    m.nodes[1]!.forcing = { waveform: 'step', v0: 0, v1: 1 };
    const issue = validate(m).find((i) => i.code === 'forcing-node');
    expect(issue?.ref).toEqual({ kind: 'node', id: 'wetland' });
    expect(issue?.message).toMatch(/integral of its flows/);
  });

  it('evaluates the kernel formulas: phase delays, clamps apply last, impulses integrate to area', () => {
    const cfg = { ...DEFAULT_CONFIG, dt: 0.5 };
    const sine = { waveform: 'sine' as const, mean: 0, amplitude: 1, period: 4, phase: 1 };
    expect(evaluateForcing(sine, 2, cfg)).toBeCloseTo(1, 12);
    expect(evaluateForcing({ ...sine, max: 0.5 }, 2, cfg)).toBe(0.5);
    const imp = { waveform: 'impulse' as const, t_on: 3, area: 2 };
    expect(evaluateForcing(imp, 3.2, cfg) * cfg.dt).toBe(2);
    expect(evaluateForcing(imp, 3.5, cfg)).toBe(0);
    expect(describeForcing(sine)).toBe('sine 0 ± 1, period 4');
  });
});
