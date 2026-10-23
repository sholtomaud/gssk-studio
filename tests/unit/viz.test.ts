import { describe, expect, it } from 'vitest';
import { SlotAssigner } from '../../src/viz/colors.ts';
import { resultCsv } from '../../src/viz/csv.ts';
import { decimate, extent, linear, niceStep, niceTicks, tickLabel } from '../../src/viz/scale.ts';
import type { RunResult } from '../../src/sim/run.ts';

describe('chart scales (SPEC §8)', () => {
  it('maps linearly and centres a degenerate domain', () => {
    const s = linear([0, 10], [0, 100]);
    expect(s(5)).toBe(50);
    expect(linear([3, 3], [0, 100])(3)).toBe(50);
  });

  it('picks 1-2-5 steps and nice domains', () => {
    expect(niceStep(100, 5)).toBe(20);
    expect(niceStep(7, 5)).toBe(2);
    expect(niceTicks(0, 97, 5)).toEqual({ domain: [0, 100], ticks: [0, 20, 40, 60, 80, 100] });
    expect(niceTicks(5, 5).ticks.length).toBeGreaterThan(1);
  });

  it('ignores non-finite values in extents', () => {
    expect(
      extent([
        [1, NaN, 5],
        [Infinity, -2],
      ])
    ).toEqual([-2, 5]);
    expect(extent([])).toEqual([0, 1]);
  });

  it('keeps the shape of a series when decimating', () => {
    const v = Array.from({ length: 10_000 }, (_, i) => (i === 4321 ? 99 : Math.sin(i / 100)));
    const idx = decimate(v, 400);
    expect(idx.length).toBeLessThanOrEqual(402);
    expect(idx).toContain(4321);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(9999);
  });

  it('labels ticks compactly', () => {
    expect(tickLabel(25_000)).toBe('25k');
    expect(tickLabel(3_500_000)).toBe('3.5M');
    expect(tickLabel(0)).toBe('0');
  });
});

describe('series colours follow the entity', () => {
  it('keeps a slot while charted and refuses a ninth series', () => {
    const s = new SlotAssigner();
    expect(s.take('a')).toBe(1);
    expect(s.take('b')).toBe(2);
    s.release('a');
    expect(s.get('b')).toBe(2);
    expect(s.take('c')).toBe(1);
    for (const id of ['d', 'e', 'f', 'g', 'h', 'i']) s.take(id);
    expect(s.take('j')).toBeNull();
  });
});

describe('results CSV (FR-RES-004)', () => {
  it('writes one row per sample', () => {
    const r = {
      times: new Float64Array([0, 1]),
      nodes: [{ id: 'tank', values: new Float64Array([1, 2]) }],
      flows: [{ id: 'f,1', values: new Float64Array([0, NaN]) }],
    } as unknown as RunResult;
    expect(resultCsv(r)).toBe('t,tank,"flow:f,1"\n0,1,0\n1,2,\n');
  });
});
