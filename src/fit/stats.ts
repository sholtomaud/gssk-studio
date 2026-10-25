/**
 * Goodness of fit between a run and observations (FR-FIT-001). Pure and
 * unit-tested. Each statistic is the standard one, named so it can be
 * looked up; none is a hypothesis test, so no p-value is reported.
 *
 * - RMSE, MAE, bias (mean of sim − obs), in the series' own units.
 * - r²: squared Pearson correlation of sim and obs.
 * - NSE: Nash–Sutcliffe efficiency, 1 − Σ(sim−obs)² / Σ(obs−mean obs)².
 *   1 is a perfect fit, 0 is no better than the observed mean.
 * - KGE: Kling–Gupta efficiency (Gupta et al. 2009),
 *   1 − √((r−1)² + (α−1)² + (β−1)²), α = σsim/σobs, β = μsim/μobs.
 */

export interface FitStats {
  /** Observations inside the run's time range, compared. */
  n: number;
  /** Observations outside it, left out. */
  excluded: number;
  rmse: number;
  mae: number;
  bias: number;
  r2: number;
  nse: number;
  kge: number;
}

/** Linear interpolation of a run series at time t; NaN outside the run. */
export function interpolate(
  times: ArrayLike<number>,
  values: ArrayLike<number>,
  t: number
): number {
  const n = times.length;
  if (n === 0) return NaN;
  const t0 = times[0] ?? NaN;
  const tn = times[n - 1] ?? NaN;
  const eps = Math.abs(tn - t0) * 1e-12;
  if (t < t0 - eps || t > tn + eps) return NaN;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? 0) <= t) lo = mid;
    else hi = mid;
  }
  const ta = times[lo] ?? 0;
  const tb = times[hi] ?? 0;
  const va = values[lo] ?? NaN;
  const vb = values[hi] ?? NaN;
  if (tb === ta) return va;
  const f = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
  return va + (vb - va) * f;
}

function mean(v: readonly number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function sd(v: readonly number[], m: number): number {
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

/** Statistics for paired simulated and observed values (same length). */
export function fitPairs(
  sim: readonly number[],
  obs: readonly number[]
): Omit<FitStats, 'excluded'> {
  const n = sim.length;
  if (n === 0) return { n: 0, rmse: NaN, mae: NaN, bias: NaN, r2: NaN, nse: NaN, kge: NaN };
  let sse = 0;
  let sae = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    const d = (sim[i] ?? 0) - (obs[i] ?? 0);
    sse += d * d;
    sae += Math.abs(d);
    sb += d;
  }
  const mo = mean(obs);
  const ms = mean(sim);
  const so = sd(obs, mo);
  const ss = sd(sim, ms);
  let cov = 0;
  for (let i = 0; i < n; i++) cov += ((sim[i] ?? 0) - ms) * ((obs[i] ?? 0) - mo);
  cov /= n;
  const r = so > 0 && ss > 0 ? cov / (so * ss) : NaN;
  const sst = obs.reduce((a, b) => a + (b - mo) ** 2, 0);
  const alpha = so > 0 ? ss / so : NaN;
  const beta = mo !== 0 ? ms / mo : NaN;
  return {
    n,
    rmse: Math.sqrt(sse / n),
    mae: sae / n,
    bias: sb / n,
    r2: r * r,
    nse: sst > 0 ? 1 - sse / sst : NaN,
    kge: 1 - Math.sqrt((r - 1) ** 2 + (alpha - 1) ** 2 + (beta - 1) ** 2),
  };
}

/** Fit of a run series to observations, interpolating the run at observation times. */
export function fitSeries(
  runTimes: ArrayLike<number>,
  runValues: ArrayLike<number>,
  obsTimes: readonly number[],
  obsValues: readonly number[]
): FitStats {
  const sim: number[] = [];
  const obs: number[] = [];
  let excluded = 0;
  obsTimes.forEach((t, i) => {
    const o = obsValues[i] ?? NaN;
    const s = interpolate(runTimes, runValues, t);
    if (Number.isFinite(s) && Number.isFinite(o)) {
      sim.push(s);
      obs.push(o);
    } else excluded++;
  });
  return { ...fitPairs(sim, obs), excluded };
}
