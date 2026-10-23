/** Linear scales and "nice" axis ticks for the time-series chart (SPEC §8). Pure, unit-tested. */

export interface Scale {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
}

export function linear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => (d1 === d0 ? (r0 + r1) / 2 : r0 + (v - d0) * k)) as Scale;
  f.domain = domain;
  f.range = range;
  return f;
}

/** A step of 1, 2 or 5 × 10ⁿ giving about `count` intervals over the span. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !(count > 0)) return 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** Domain widened to whole steps, and the ticks across it. */
export function niceTicks(
  lo: number,
  hi: number,
  count = 5
): { domain: [number, number]; ticks: number[] } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { domain: [0, 1], ticks: [0, 1] };
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, count);
  const d0 = Math.floor(lo / step + 1e-9) * step;
  const d1 = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = d0, i = 0; v <= d1 + step * 1e-6 && i < 50; v += step, i++) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return { domain: [d0, d1], ticks };
}

/** Min and max over several series, ignoring non-finite values. */
export function extent(series: readonly ArrayLike<number>[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    for (let i = 0; i < s.length; i++) {
      const v = s[i] ?? NaN;
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  return lo <= hi ? [lo, hi] : [0, 1];
}

/** Compact tick label: 1.2k, 3.5M, 0.002. */
export function tickLabel(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}k`;
  if (a === 0) return '0';
  if (a < 0.01) return v.toExponential(0);
  return String(+v.toPrecision(4));
}

/** Indices of at most `n` points that keep a series' shape (min/max per bucket). */
export function decimate(values: ArrayLike<number>, n: number): number[] {
  const len = values.length;
  if (len <= n) return Array.from({ length: len }, (_, i) => i);
  const buckets = Math.max(1, Math.floor(n / 2));
  const size = len / buckets;
  const out: number[] = [0];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(len, Math.floor((b + 1) * size));
    let lo = start;
    let hi = start;
    for (let i = start; i < end; i++) {
      if ((values[i] ?? 0) < (values[lo] ?? 0)) lo = i;
      if ((values[i] ?? 0) > (values[hi] ?? 0)) hi = i;
    }
    out.push(Math.min(lo, hi), Math.max(lo, hi));
  }
  out.push(len - 1);
  return [...new Set(out)].sort((a, b) => a - b);
}
