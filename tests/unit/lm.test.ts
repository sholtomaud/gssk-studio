import { describe, expect, it } from 'vitest';
import { invert, LevenbergMarquardt, solve } from '../../src/fit/lm.ts';

describe('linear algebra', () => {
  it('solves and inverts small systems', () => {
    expect(
      solve(
        [
          [2, 1],
          [1, 3],
        ],
        [3, 5]
      )?.map((v) => +v.toFixed(12))
    ).toEqual([0.8, 1.4]);
    expect(
      solve(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2]
      )
    ).toBeNull();
    const inv = invert([
      [4, 0],
      [0, 2],
    ]);
    expect(inv).toEqual([
      [0.25, 0],
      [0, 0.5],
    ]);
  });
});

describe('Levenberg–Marquardt (FR-CAL-001)', () => {
  // y = a·exp(−b·t): the textbook non-linear fit.
  const ts = Array.from({ length: 20 }, (_, i) => i * 0.5);
  const truth = [5, 0.3];
  const ys = ts.map((t) => truth[0]! * Math.exp(-truth[1]! * t));
  const r = (th: readonly number[]) => ts.map((t, i) => th[0]! * Math.exp(-th[1]! * t) - ys[i]!);

  it('recovers known parameters from a poor start, deterministically', () => {
    const run = () => {
      const lm = new LevenbergMarquardt(r, [1, 1]);
      while (!lm.done) lm.iterate();
      return lm.state;
    };
    const a = run();
    expect(a.stop).toBe('converged');
    expect(a.theta[0]).toBeCloseTo(5, 5);
    expect(a.theta[1]).toBeCloseTo(0.3, 6);
    expect(run()).toEqual(a);
  });

  it('stops at its iteration cap', () => {
    const lm = new LevenbergMarquardt(r, [1, 1], { maxIterations: 2 });
    while (!lm.done) lm.iterate();
    expect(lm.state.stop).toBe('max-iterations');
    expect(lm.state.iteration).toBe(2);
  });

  it('gives standard errors that shrink with less noise, and none for an uninformed parameter', () => {
    const noisy = ys.map((y, i) => y + (i % 2 ? 0.05 : -0.05));
    const rn = (th: readonly number[]) =>
      ts.map((t, i) => th[0]! * Math.exp(-th[1]! * t) - noisy[i]!);
    const lm = new LevenbergMarquardt(rn, [4, 0.4]);
    while (!lm.done) lm.iterate();
    const se = lm.standardErrors();
    expect(se?.[0]).toBeGreaterThan(0);
    expect(se?.[0]).toBeLessThan(0.1);
    // A third parameter the residuals ignore has a zero Jacobian column.
    const ignored = new LevenbergMarquardt((th) => rn(th.slice(0, 2)), [4, 0.4, 7]);
    while (!ignored.done) ignored.iterate();
    expect(ignored.standardErrors()).toBeNull();
    expect(ignored.state.theta[2]).toBe(7);
  });
});
