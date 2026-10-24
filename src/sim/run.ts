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

export async function runModel(kernel: GsskKernel, model: StudioModel): Promise<RunResult> {
  const started = performance.now();
  const json = canonicalJson(toKernelModel(model));
  const modelHash = await sha256Hex(json);
  const inst = kernel.init(json);
  try {
    const { t_start, t_end, dt } = { t_start: inst.tStart, t_end: inst.tEnd, dt: inst.dt };
    const steps = Math.max(1, Math.round((t_end - t_start) / dt));
    const stride = Math.max(1, Math.ceil(steps / (MAX_SAMPLES - 1)));
    const samples = Math.floor(steps / stride) + 1 + (steps % stride ? 1 : 0);

    const cols = columnsFor(model, inst);
    const nodes: NodeSeries[] = model.nodes.flatMap((n) => {
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
    const edgeCols = model.edges.map((e) => ({
      id: e.id,
      sensed: e.visual?.sensor === true,
      column: inst.edgeIds.indexOf(e.id),
    }));
    const flows: FlowSeries[] = edgeCols
      .filter((e) => e.column >= 0)
      .map((e) => ({ id: e.id, sensed: e.sensed, values: new Float64Array(samples) }));
    const flowCols = edgeCols.filter((e) => e.column >= 0).map((e) => e.column);

    const times = new Float64Array(samples);
    const state = new Float64Array(inst.nodeIds.length);
    const flowBuf = new Float64Array(inst.edgeIds.length);
    let sample = 0;
    const record = (t: number) => {
      inst.stateInto(state);
      inst.flowsInto(flowBuf);
      times[sample] = t;
      for (const s of nodes) s.values[sample] = state[s.column] ?? NaN;
      flows.forEach((f, i) => (f.values[sample] = flowBuf[flowCols[i] ?? -1] ?? NaN));
      sample++;
    };

    let confident = true;
    let divergedSteps = 0;
    let maxCons = 0;
    record(t_start);
    for (let s = 1; s <= steps; s++) {
      if (inst.step(dt)) divergedSteps++;
      confident &&= inst.solverConfident();
      const ce = Math.abs(inst.conservationError());
      if (Number.isFinite(ce)) maxCons = Math.max(maxCons, ce);
      if (s % stride === 0 || s === steps) record(t_start + s * dt);
    }

    const final: Record<string, number> = {};
    for (const s of nodes) final[s.id] = s.values[sample - 1] ?? NaN;

    return {
      manifest: {
        kernelVersion: kernel.info.version,
        kernelSha256: kernel.info.sha256,
        modelHash,
        method: model.config.method,
        t_start,
        t_end,
        dt,
        steps,
        samples: sample,
      },
      times: times.subarray(0, sample),
      nodes: nodes.map((n) => ({ ...n, values: n.values.subarray(0, sample) })),
      flows: flows.map((f) => ({ ...f, values: f.values.subarray(0, sample) })),
      final,
      diagnostics: {
        solverConfident: confident && divergedSteps === 0,
        divergedSteps,
        maxConservationError: maxCons,
      },
      elapsedMs: performance.now() - started,
    };
  } finally {
    inst.free();
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
