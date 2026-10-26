/**
 * Run a studio model to its end time on the kernel (FR-SIM-001). Runs are
 * whole: the worker integrates t_start → t_end, records a bounded number of
 * samples, and the UI plays the result back (ADR 0004). Nothing here touches
 * the DOM, so it runs the same in a worker, in Node and in tests.
 */
import { symbolFor } from '../model/catalogue.ts';
import { canonicalJson, toKernelModel } from '../model/kernel-json.ts';
import type { NodeType, StudioModel } from '../model/types.ts';
import { sha256Hex, type GsskInstance, type GsskKernel } from './gssk.ts';

/** Samples kept per series; the final state is always kept exactly. */
export const MAX_SAMPLES = 2000;

export interface NodeSeries {
  /** The studio node id (for a composite, its instance id, not the member's). */
  id: string;
  label: string;
  type: NodeType;
  holdsState: boolean;
  /** Kernel state column the series reads. */
  column: number;
  values: Float64Array;
}

export interface FlowSeries {
  id: string;
  /** A sensor sits on this flow, so its rate is offered as a chart series (FR-EDIT-010). */
  sensed: boolean;
  values: Float64Array;
}

/** What a run was, so it can be reproduced and cited (NFR-HON-001). */
export interface RunManifest {
  kernelVersion: string;
  kernelSha256: string;
  /** SHA-256 of the canonical kernel JSON: the model, not its layout. */
  modelHash: string;
  method: string;
  t_start: number;
  t_end: number;
  dt: number;
  steps: number;
  samples: number;
  /** The kernel RNG seed: jitter forcing draws from it, so it is part of the run's identity. */
  seed: string;
}

export interface RunDiagnostics {
  /** False if the auto-mode dual solver lost agreement at any step. */
  solverConfident: boolean;
  /** Steps the kernel took while warning GSSK_WARN_SOLVER_DIVERGENCE. */
  divergedSteps: number;
  maxConservationError: number;
}

export interface RunResult {
  manifest: RunManifest;
  times: Float64Array;
  nodes: NodeSeries[];
  flows: FlowSeries[];
  /** Final value per studio node id. */
  final: Record<string, number>;
  diagnostics: RunDiagnostics;
  elapsedMs: number;
}

/**
 * The kernel column that represents each studio node. A composite expands at
 * init into members; it is represented by its body (or its only member).
 */
export function columnsFor(model: StudioModel, inst: GsskInstance): Map<string, number> {
  const cols = new Map<string, number>();
  const members = new Map<string, { index: number; role: string }[]>();
  inst.nodeIds.forEach((id, i) => {
    const owner = inst.nodeComposite(i);
    if (owner) {
      const list = members.get(owner) ?? [];
      list.push({ index: i, role: inst.nodeRole(i) });
      members.set(owner, list);
    } else {
      cols.set(id, i);
    }
  });
  for (const n of model.nodes) {
    const list = members.get(n.id);
    if (!list?.length) continue;
    const body = list.find((m) => m.role === 'body') ?? list[0];
    if (body) cols.set(n.id, body.index);
  }
  return cols;
}

/**
 * A run in progress (FR-SIM-005). It owns its kernel instance and advances
 * in time-boxed chunks, so the worker can report progress between chunks and
 * a cancel takes effect at the next one. `close()` frees the instance; it is
 * safe to call twice.
 */
export class RunSession {
  readonly steps: number;
  private readonly started = performance.now();
  private readonly kernel: GsskKernel;
  private readonly model: StudioModel;
  private readonly modelHash: string;
  private readonly seed: string;
  private inst: GsskInstance | null;
  private readonly t0: number;
  private readonly dt: number;
  private readonly tEnd: number;
  private readonly stride: number;
  private readonly nodes: NodeSeries[];
  private readonly flows: FlowSeries[];
  private readonly flowCols: number[];
  private readonly times: Float64Array;
  private readonly state: Float64Array;
  private readonly flowBuf: Float64Array;
  private sample = 0;
  private step = 0;
  private confident = true;
  private divergedSteps = 0;
  private maxCons = 0;

  private constructor(kernel: GsskKernel, model: StudioModel, json: string, modelHash: string) {
    this.kernel = kernel;
    this.model = model;
    this.modelHash = modelHash;
    const inst = kernel.init(json);
    this.inst = inst;
    this.seed = inst.seed;
    this.t0 = inst.tStart;
    this.tEnd = inst.tEnd;
    this.dt = inst.dt;
    this.steps = Math.max(1, Math.round((this.tEnd - this.t0) / this.dt));
    this.stride = Math.max(1, Math.ceil(this.steps / (MAX_SAMPLES - 1)));
    const samples = Math.floor(this.steps / this.stride) + 1 + (this.steps % this.stride ? 1 : 0);

    const cols = columnsFor(model, inst);
    this.nodes = model.nodes.flatMap((n) => {
      const column = cols.get(n.id);
      if (column === undefined) return [];
      return [
        {
          id: n.id,
          label: n.visual.label ?? n.id,
          type: n.type,
          holdsState: symbolFor(n.type).holdsState,
          column,
          values: new Float64Array(samples),
        },
      ];
    });
    const edgeCols = model.edges
      .map((e) => ({
        id: e.id,
        sensed: e.visual?.sensor === true,
        column: inst.edgeIds.indexOf(e.id),
      }))
      .filter((e) => e.column >= 0);
    this.flows = edgeCols.map((e) => ({
      id: e.id,
      sensed: e.sensed,
      values: new Float64Array(samples),
    }));
    this.flowCols = edgeCols.map((e) => e.column);
    this.times = new Float64Array(samples);
    this.state = new Float64Array(inst.nodeIds.length);
    this.flowBuf = new Float64Array(inst.edgeIds.length);
    this.record(this.t0);
  }

  static async start(kernel: GsskKernel, model: StudioModel): Promise<RunSession> {
    const json = canonicalJson(toKernelModel(model));
    return new RunSession(kernel, model, json, await sha256Hex(json));
  }

  get done(): boolean {
    return this.step >= this.steps;
  }

  /** Steps taken so far. */
  get progress(): number {
    return this.step;
  }

  private get live(): GsskInstance {
    if (!this.inst) throw new Error('Run already closed');
    return this.inst;
  }

  private record(t: number): void {
    const inst = this.live;
    inst.stateInto(this.state);
    inst.flowsInto(this.flowBuf);
    this.times[this.sample] = t;
    for (const s of this.nodes) s.values[this.sample] = this.state[s.column] ?? NaN;
    this.flows.forEach(
      (f, i) => (f.values[this.sample] = this.flowBuf[this.flowCols[i] ?? -1] ?? NaN)
    );
    this.sample++;
  }

  /** Step until done or about `budgetMs` has passed; returns steps taken so far. */
  advance(budgetMs = Infinity): number {
    const inst = this.live;
    const deadline = performance.now() + budgetMs;
    while (this.step < this.steps) {
      // Check the clock every 64 steps: reading it costs more than a small step.
      for (let k = 0; k < 64 && this.step < this.steps; k++) {
        const s = ++this.step;
        if (inst.step(this.dt)) this.divergedSteps++;
        this.confident &&= inst.solverConfident();
        const ce = Math.abs(inst.conservationError());
        if (Number.isFinite(ce)) this.maxCons = Math.max(this.maxCons, ce);
        if (s % this.stride === 0 || s === this.steps) this.record(this.t0 + s * this.dt);
      }
      if (performance.now() >= deadline) break;
    }
    return this.step;
  }

  /** The finished run. Closes the session. */
  result(): RunResult {
    if (!this.done) throw new Error('Run not finished');
    const n = this.sample;
    const final: Record<string, number> = {};
    for (const s of this.nodes) final[s.id] = s.values[n - 1] ?? NaN;
    const result: RunResult = {
      manifest: {
        kernelVersion: this.kernel.info.version,
        kernelSha256: this.kernel.info.sha256,
        modelHash: this.modelHash,
        method: this.model.config.method,
        t_start: this.t0,
        t_end: this.tEnd,
        dt: this.dt,
        steps: this.steps,
        samples: n,
        seed: this.seed,
      },
      times: this.times.subarray(0, n),
      nodes: this.nodes.map((x) => ({ ...x, values: x.values.subarray(0, n) })),
      flows: this.flows.map((x) => ({ ...x, values: x.values.subarray(0, n) })),
      final,
      diagnostics: {
        solverConfident: this.confident && this.divergedSteps === 0,
        divergedSteps: this.divergedSteps,
        maxConservationError: this.maxCons,
      },
      elapsedMs: performance.now() - this.started,
    };
    this.close();
    return result;
  }

  close(): void {
    this.inst?.free();
    this.inst = null;
  }
}

/** A whole run in one call: for tests, the self-test and small models. */
export async function runModel(kernel: GsskKernel, model: StudioModel): Promise<RunResult> {
  const session = await RunSession.start(kernel, model);
  try {
    session.advance();
    return session.result();
  } finally {
    session.close();
  }
}

/** Index of the sample nearest time t (times ascending). */
export function sampleAt(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs((times[lo - 1] ?? 0) - t) <= Math.abs((times[lo] ?? 0) - t)) return lo - 1;
  return lo;
}
