/**
 * Calibration of flow rates to observations (FR-CAL-001, ADR 0008).
 *
 * Least squares over θ = ln k (so every rate stays positive), solved by
 * Levenberg–Marquardt with a forward-difference Jacobian. Every residual
 * evaluation is a real run on the pinned kernel; the app only chooses the
 * next rates. Each observed series is scaled by its own spread, so series in
 * different units weigh alike.
 */
import { canonicalJson, toKernelModel } from '../model/kernel-json.ts';
import { cloneModel, type StudioModel } from '../model/types.ts';
import type { GsskKernel } from '../sim/gssk.ts';
import { columnsFor } from '../sim/run.ts';
import { LevenbergMarquardt, type LmStop } from './lm.ts';
import { fitSeries, interpolate, type FitStats } from './stats.ts';

export interface CalibratedRate {
  edgeId: string;
  before: number;
  after: number;
  /** Linearised standard error of k at the optimum, or null if not estimable. */
  se: number | null;
  /** False when the observations barely change with this rate. */
  informed: boolean;
}

export interface SeriesFit {
  obsId: string;
  name: string;
  target: string;
  before: FitStats;
  after: FitStats;
}

export interface CalibrationResult {
  rates: CalibratedRate[];
  fits: SeriesFit[];
  sseBefore: number;
  sseAfter: number;
  iterations: number;
  /** Kernel runs used. */
  runs: number;
  stop: LmStop;
  /** The model with the calibrated rates; the caller decides whether to keep it. */
  model: StudioModel;
}

export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationError';
  }
}

/** Every-step trajectories of the given targets (node ids or `flow:<edge>`). */
export function trajectories(
  kernel: GsskKernel,
  model: StudioModel,
  targets: readonly string[]
): { times: Float64Array; series: Map<string, Float64Array> } {
  const inst = kernel.init(canonicalJson(toKernelModel(model)));
  try {
    const steps = Math.max(1, Math.round((inst.tEnd - inst.tStart) / inst.dt));
    const cols = columnsFor(model, inst);
    const pick = targets.map((t) =>
      t.startsWith('flow:')
        ? { t, flow: true, i: inst.edgeIds.indexOf(t.slice(5)) }
        : { t, flow: false, i: cols.get(t) ?? -1 }
    );
    const times = new Float64Array(steps + 1);
    const series = new Map(pick.map((p) => [p.t, new Float64Array(steps + 1)]));
    const state = new Float64Array(inst.nodeIds.length);
    const flows = new Float64Array(inst.edgeIds.length);
    const record = (s: number) => {
      inst.stateInto(state);
      inst.flowsInto(flows);
      times[s] = inst.tStart + s * inst.dt;
      for (const p of pick)
        (series.get(p.t) as Float64Array)[s] =
          p.i < 0 ? NaN : ((p.flow ? flows : state)[p.i] ?? NaN);
    };
    record(0);
    for (let s = 1; s <= steps; s++) {
      inst.step();
      record(s);
    }
    return { times, series };
  } finally {
    inst.free();
  }
}

function spread(v: readonly number[]): number {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  if (sd > 0) return sd;
  const mag = v.reduce((a, b) => a + Math.abs(b), 0) / v.length;
  return mag > 0 ? mag : 1;
}

export class CalibrationSession {
  readonly maxIterations: number;
  private readonly kernel: GsskKernel;
  private readonly model: StudioModel;
  private readonly edgeIds: string[];
  private readonly before: number[];
  private readonly lm: LevenbergMarquardt;
  private readonly obs: NonNullable<StudioModel['_observations']>;
  private readonly targets: string[];
  private readonly sse0: number;

  constructor(
    kernel: GsskKernel,
    model: StudioModel,
    edgeIds: readonly string[],
    maxIterations = 40
  ) {
    this.kernel = kernel;
    this.model = model;
    this.maxIterations = maxIterations;
    const known = new Set([
      ...model.nodes.map((n) => n.id),
      ...model.edges.map((e) => `flow:${e.id}`),
    ]);
    this.obs = (model._observations ?? []).filter(
      (o) => o.target && known.has(o.target) && o.times.length > 0
    );
    if (this.obs.length === 0) {
      throw new CalibrationError(
        'Compare at least one observation series with a symbol first (Observations).'
      );
    }
    if (edgeIds.length === 0) throw new CalibrationError('Choose at least one rate to calibrate.');
    this.edgeIds = [...edgeIds];
    this.before = this.edgeIds.map((id) => {
      const e = model.edges.find((x) => x.id === id);
      if (!e) throw new CalibrationError(`No flow “${id}”.`);
      if (!(e.params.k > 0))
        throw new CalibrationError(
          `Flow “${id}” has k = ${e.params.k}; only positive rates can be calibrated.`
        );
      return e.params.k;
    });
    this.targets = [...new Set(this.obs.map((o) => o.target as string))];
    const scales = this.obs.map((o) => spread(o.values));
    const residuals = (theta: readonly number[]): number[] => {
      const run = trajectories(this.kernel, this.withRates(theta.map(Math.exp)), this.targets);
      const out: number[] = [];
      this.obs.forEach((o, j) => {
        const sim = run.series.get(o.target as string);
        o.times.forEach((t, i) => {
          const v = sim ? interpolate(run.times, sim, t) : NaN;
          // Points outside the run carry no information either way.
          if (Number.isFinite(v)) out.push((v - (o.values[i] ?? 0)) / (scales[j] ?? 1));
        });
      });
      // A diverged run must not look like a good fit.
      return out.map((v) => (Number.isFinite(v) ? v : 1e6));
    };
    this.lm = new LevenbergMarquardt(residuals, this.before.map(Math.log), { maxIterations });
    this.sse0 = this.lm.state.sse;
  }

  private withRates(ks: readonly number[]): StudioModel {
    const m = cloneModel(this.model);
    this.edgeIds.forEach((id, i) => {
      const e = m.edges.find((x) => x.id === id);
      if (e) e.params.k = Number((ks[i] ?? e.params.k).toPrecision(12));
    });
    return m;
  }

  get done(): boolean {
    return this.lm.done;
  }

  get progress(): { iteration: number; maxIterations: number; sse: number } {
    return {
      iteration: this.lm.state.iteration,
      maxIterations: this.maxIterations,
      sse: this.lm.state.sse,
    };
  }

  /** Iterate for about `budgetMs` (at least one iteration). */
  advance(budgetMs = Infinity): void {
    const deadline = performance.now() + budgetMs;
    do this.lm.iterate();
    while (!this.lm.done && performance.now() < deadline);
  }

  result(): CalibrationResult {
    const s = this.lm.state;
    const after = s.theta.map(Math.exp);
    const seTheta = this.lm.standardErrors();
    const J = this.lm.jacobian;
    const colNorm = (j: number) => Math.sqrt(J.reduce((a, row) => a + (row[j] ?? 0) ** 2, 0));
    const norms = this.edgeIds.map((_, j) => colNorm(j));
    const biggest = Math.max(...norms, 0);
    // Six significant figures: far finer than any standard error a fit supports.
    const model = this.withRates(after.map((k) => Number(k.toPrecision(6))));
    const fitsOf = (m: StudioModel) => {
      const run = trajectories(this.kernel, m, this.targets);
      return this.obs.map((o) =>
        fitSeries(run.times, run.series.get(o.target as string) ?? [], o.times, o.values)
      );
    };
    const b = fitsOf(this.model);
    const a = fitsOf(model);
    return {
      rates: this.edgeIds.map((edgeId, j) => ({
        edgeId,
        before: this.before[j] ?? NaN,
        after: model.edges.find((e) => e.id === edgeId)?.params.k ?? NaN,
        se: seTheta ? (after[j] ?? 0) * (seTheta[j] ?? 0) : null,
        informed: biggest > 0 && (norms[j] ?? 0) > biggest * 1e-6,
      })),
      fits: this.obs.map((o, i) => ({
        obsId: o.id,
        name: o.name,
        target: o.target as string,
        before: b[i] as FitStats,
        after: a[i] as FitStats,
      })),
      sseBefore: this.sse0,
      sseAfter: s.sse,
      iterations: s.iteration,
      runs: s.evaluations,
      stop: s.stop,
      model,
    };
  }
}
