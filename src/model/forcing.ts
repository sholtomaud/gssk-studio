/**
 * Forcing functions (FR-FRC-001): a waveform that drives a source's or a
 * constant's held value, or an edge's rate k, over time. The vocabulary and
 * its formulas are the kernel's (`$defs/Forcing` in gssk.schema.json); the
 * studio stores the block as the kernel reads it. `evaluateForcing` mirrors
 * the kernel's formulas for the inspector's preview, and a kernel test holds
 * the two equal.
 */
import {
  WAVEFORMS,
  type Forcing,
  type ModelConfig,
  type NodeType,
  type Waveform,
} from './types.ts';

/** Node types whose held value a forcing may drive. A storage's value is its flows' integral. */
export const FORCEABLE_NODES: readonly NodeType[] = ['source', 'constant'];

export function canForceNode(type: NodeType): boolean {
  return FORCEABLE_NODES.includes(type);
}

type NumKey =
  | 't_on'
  | 'v0'
  | 'v1'
  | 'area'
  | 'slope'
  | 'rate'
  | 'period'
  | 'phase'
  | 'duty'
  | 'mean'
  | 'amplitude';

export interface FieldSpec {
  key: NumKey;
  label: string;
  hint: string;
}

const T_ON: FieldSpec = {
  key: 't_on',
  label: 'Onset t_on',
  hint: 'Switch-on time; blank is t_start.',
};
const PERIODIC: FieldSpec[] = [
  { key: 'mean', label: 'Mean', hint: 'The centre value.' },
  { key: 'amplitude', label: 'Amplitude', hint: 'Half the peak-to-peak range.' },
  { key: 'period', label: 'Period', hint: 'In time units; required and positive.' },
  { key: 'phase', label: 'Phase', hint: 'A time offset; positive delays the wave.' },
];

export interface WaveformInfo {
  label: string;
  /** The formula, as the kernel schema states it. */
  formula: string;
  fields: FieldSpec[];
}

export const WAVEFORM_INFO: Record<Waveform, WaveformInfo> = {
  step: {
    label: 'Step',
    formula: 'v0 before t_on, v1 from t_on',
    fields: [
      T_ON,
      { key: 'v0', label: 'Before v0', hint: 'Value before t_on.' },
      { key: 'v1', label: 'After v1', hint: 'Value at and after t_on.' },
    ],
  },
  impulse: {
    label: 'Impulse',
    formula: 'area / dt for one step at t_on, so its integral is area at any dt',
    fields: [T_ON, { key: 'area', label: 'Area', hint: 'The integral delivered.' }],
  },
  ramp: {
    label: 'Ramp',
    formula: 'v0 before t_on, then v0 + slope·(t − t_on)',
    fields: [
      T_ON,
      { key: 'v0', label: 'Start v0', hint: 'Value at t_on.' },
      { key: 'slope', label: 'Slope', hint: 'Change per unit time.' },
    ],
  },
  exponential: {
    label: 'Exponential',
    formula: 'v0 before t_on, then v0·exp(rate·(t − t_on))',
    fields: [
      T_ON,
      { key: 'v0', label: 'Start v0', hint: 'Value at t_on.' },
      { key: 'rate', label: 'Rate', hint: 'Growth if positive, decay if negative.' },
    ],
  },
  sine: {
    label: 'Sine',
    formula: 'mean + amplitude·sin(2π(t − t_on − phase)/period)',
    fields: [T_ON, ...PERIODIC],
  },
  square: {
    label: 'Square',
    formula: 'mean + amplitude for a duty fraction of each period, mean − amplitude after',
    fields: [
      T_ON,
      ...PERIODIC,
      { key: 'duty', label: 'Duty', hint: 'Fraction of each period high, 0–1.' },
    ],
  },
  sawtooth: {
    label: 'Sawtooth',
    formula: 'rises from mean − amplitude to mean + amplitude each period',
    fields: [T_ON, ...PERIODIC],
  },
  jitter: {
    label: 'Jitter (random)',
    formula: 'mean + amplitude·(2u − 1), u uniform, drawn once per step from the seeded kernel RNG',
    fields: [
      { key: 'mean', label: 'Mean', hint: 'The centre value.' },
      { key: 'amplitude', label: 'Amplitude', hint: 'Half the range of the draws.' },
    ],
  },
  table: {
    label: 'Table (data)',
    formula: 'a series of (t, value) points in model time',
    fields: [],
  },
};

/** A reasonable first waveform around a current value `v` over the run. */
export function defaultForcing(waveform: Waveform, v: number, cfg: ModelConfig): Forcing {
  const span = cfg.t_end - cfg.t_start;
  const mid = cfg.t_start + span / 2;
  const amp = v === 0 ? 1 : Math.abs(v) / 2;
  switch (waveform) {
    case 'step':
      return { waveform, t_on: mid, v0: v, v1: v === 0 ? 1 : v * 2 };
    case 'impulse':
      return { waveform, t_on: mid, area: v === 0 ? 1 : v };
    case 'ramp':
      return { waveform, v0: v, slope: (v === 0 ? 1 : v) / span };
    case 'exponential':
      return { waveform, v0: v === 0 ? 1 : v, rate: 1 / span };
    case 'sine':
    case 'sawtooth':
      return { waveform, mean: v, amplitude: amp, period: span / 4 };
    case 'square':
      return { waveform, mean: v, amplitude: amp, period: span / 4, duty: 0.5 };
    case 'jitter':
      return { waveform, mean: v, amplitude: amp };
    case 'table':
      return {
        waveform,
        times: [cfg.t_start, mid, cfg.t_end],
        values: [v, v === 0 ? 1 : v * 2, v],
        interpolation: 'linear',
        extrapolation: 'hold',
      };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const NUM_KEYS: readonly (NumKey | 'min' | 'max')[] = [
  't_on',
  'v0',
  'v1',
  'area',
  'slope',
  'rate',
  'period',
  'phase',
  'duty',
  'mean',
  'amplitude',
  'min',
  'max',
];

/** Read a forcing block from a file: known keys of the right type, nothing else. */
export function parseForcing(raw: unknown): Forcing | undefined {
  if (!isObj(raw) || !WAVEFORMS.includes(raw.waveform as Waveform)) return undefined;
  const f: Forcing = { waveform: raw.waveform as Waveform };
  for (const k of NUM_KEYS) if (finite(raw[k])) f[k] = raw[k];
  if (Array.isArray(raw.times) && raw.times.every(finite)) f.times = [...raw.times];
  if (Array.isArray(raw.values) && raw.values.every(finite)) f.values = [...raw.values];
  if (raw.interpolation === 'linear' || raw.interpolation === 'step')
    f.interpolation = raw.interpolation;
  if (raw.extrapolation === 'hold' || raw.extrapolation === 'cycle')
    f.extrapolation = raw.extrapolation;
  return f;
}

/** What GSSK_Init would reject, in words (FR-VAL-001). */
export function forcingProblems(f: Forcing): string[] {
  const out: string[] = [];
  const periodic = f.waveform === 'sine' || f.waveform === 'square' || f.waveform === 'sawtooth';
  if (periodic && !(finite(f.period) && f.period > 0))
    out.push(`a ${f.waveform} forcing needs a positive period`);
  if (f.duty !== undefined && (f.duty < 0 || f.duty > 1)) out.push('duty must be between 0 and 1');
  if (f.min !== undefined && f.max !== undefined && f.min > f.max)
    out.push('the lower clamp is above the upper clamp');
  if (f.waveform === 'table') {
    const t = f.times ?? [];
    const v = f.values ?? [];
    if (t.length === 0) out.push('a table forcing needs at least one point');
    else if (t.length !== v.length) out.push('a table forcing needs one value per time');
    else if (t.some((x, i) => i > 0 && x <= (t[i - 1] ?? -Infinity)))
      out.push('table times must be strictly increasing');
  }
  return out;
}

/**
 * The waveform's value at t, by the kernel's formulas. Jitter has no single
 * value; this returns its mean (the preview draws its band instead).
 */
export function evaluateForcing(f: Forcing, t: number, cfg: ModelConfig): number {
  const tOn = f.t_on ?? cfg.t_start;
  const tau = t - tOn;
  const frac = (x: number) => x - Math.floor(x);
  const mean = f.mean ?? 0;
  const amp = f.amplitude ?? 0;
  const period = f.period ?? NaN;
  const phase = f.phase ?? 0;
  let v: number;
  switch (f.waveform) {
    case 'step':
      v = t < tOn ? (f.v0 ?? 0) : (f.v1 ?? 0);
      break;
    case 'impulse':
      v = t >= tOn && t < tOn + cfg.dt ? (f.area ?? 0) / cfg.dt : 0;
      break;
    case 'ramp':
      v = t < tOn ? (f.v0 ?? 0) : (f.v0 ?? 0) + (f.slope ?? 0) * tau;
      break;
    case 'exponential':
      v = t < tOn ? (f.v0 ?? 0) : (f.v0 ?? 0) * Math.exp((f.rate ?? 0) * tau);
      break;
    case 'sine':
      v = mean + amp * Math.sin((2 * Math.PI * (tau - phase)) / period);
      break;
    case 'square':
      v = frac((tau - phase) / period) < (f.duty ?? 0.5) ? mean + amp : mean - amp;
      break;
    case 'sawtooth':
      v = mean + amp * (2 * frac((tau - phase) / period) - 1);
      break;
    case 'jitter':
      v = mean;
      break;
    case 'table':
      v = tableAt(f, t);
      break;
  }
  if (f.min !== undefined) v = Math.max(f.min, v);
  if (f.max !== undefined) v = Math.min(f.max, v);
  return v;
}

function tableAt(f: Forcing, t: number): number {
  const ts = f.times ?? [];
  const vs = f.values ?? [];
  const n = Math.min(ts.length, vs.length);
  if (n === 0) return 0;
  const first = ts[0] ?? 0;
  const last = ts[n - 1] ?? 0;
  if (n === 1) return vs[0] ?? 0;
  if (f.extrapolation === 'cycle' && last > first) {
    t = first + ((((t - first) % (last - first)) + (last - first)) % (last - first));
  }
  if (t <= first) return vs[0] ?? 0;
  if (t >= last) return vs[n - 1] ?? 0;
  let i = 1;
  while (i < n - 1 && (ts[i] ?? 0) <= t) i++;
  const t0 = ts[i - 1] ?? 0;
  const t1 = ts[i] ?? 0;
  const v0 = vs[i - 1] ?? 0;
  const v1 = vs[i] ?? 0;
  if (f.interpolation === 'step') return v0;
  return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}

/** A one-line summary for the canvas tooltip and the inspector. */
export function describeForcing(f: Forcing): string {
  const n = (v: number | undefined) => (v === undefined ? '?' : String(+v.toPrecision(4)));
  switch (f.waveform) {
    case 'step':
      return `step ${n(f.v0)} → ${n(f.v1)} at t ${f.t_on === undefined ? 'start' : n(f.t_on)}`;
    case 'impulse':
      return `impulse of ${n(f.area)} at t ${f.t_on === undefined ? 'start' : n(f.t_on)}`;
    case 'ramp':
      return `ramp from ${n(f.v0)}, slope ${n(f.slope)}`;
    case 'exponential':
      return `exponential from ${n(f.v0)}, rate ${n(f.rate)}`;
    case 'jitter':
      return `random ${n(f.mean)} ± ${n(f.amplitude)}`;
    case 'table':
      return `table of ${f.times?.length ?? 0} points`;
    default:
      return `${f.waveform} ${n(f.mean)} ± ${n(f.amplitude)}, period ${n(f.period)}`;
  }
}
