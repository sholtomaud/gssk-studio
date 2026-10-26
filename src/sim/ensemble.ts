/**
 * Ensembles (FR-ENS-001): many runs of one model, each with its rates
 * perturbed, reduced by the kernel to a pointwise envelope. The kernel's
 * GSSK_EnsembleForecast does the work; this module seeds it, bounds it,
 * samples it like a run and labels it, so a band on the chart says exactly
 * what made it (NFR-HON-001).
 */
import { canonicalJson, toKernelModel } from '../model/kernel-json.ts';
import type { StudioModel } from '../model/types.ts';
import { sha256Hex, type GsskKernel } from './gssk.ts';
import { columnsFor, MAX_SAMPLES, type RunManifest } from './run.ts';

export const MAX_RUNS = 500;
/** Envelope cells (steps × kernel nodes) the kernel may hold: three doubles each. */
export const MAX_CELLS = 4_000_000;

export interface EnsembleOptions {
  runs: number;
  /** Each run scales every edge's k by a uniform draw from [1 − p, 1 + p]. */
  perturbation: number;
  /** uint64 seed as a decimal string; the same seed gives the same ensemble. */
  seed: string;
}

export interface EnsembleSeries {
  id: string;
  label: string;
  min: Float64Array;
  mean: Float64Array;
  max: Float64Array;
}

export interface EnsembleResult {
  manifest: RunManifest & { runs: number; perturbation: number };
  times: Float64Array;
  nodes: EnsembleSeries[];
  elapsedMs: number;
}

export class EnsembleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnsembleError';
  }
}

export async function ensembleModel(
  kernel: GsskKernel,
  model: StudioModel,
  opts: EnsembleOptions
): Promise<EnsembleResult> {
  const started = performance.now();
  const runs = Math.round(opts.runs);
  if (!(runs >= 2 && runs <= MAX_RUNS))
    throw new EnsembleError(`Use between 2 and ${MAX_RUNS} runs.`);
  if (!(opts.perturbation > 0 && opts.perturbation < 1))
    throw new EnsembleError('The perturbation must be above 0 % and below 100 %.');
  if (!/^\d{1,20}$/.test(opts.seed) || BigInt(opts.seed) >= 2n ** 64n)
    throw new EnsembleError('The seed must be a whole number from 0 to 2⁶⁴ − 1.');
  const json = canonicalJson(toKernelModel(model));
  const modelHash = await sha256Hex(json);
  const inst = kernel.init(json);
  try {
    const t0 = inst.tStart;
    const dt = inst.dt;
    const steps = Math.max(1, Math.round((inst.tEnd - t0) / dt));
    if ((steps + 1) * inst.nodeIds.length > MAX_CELLS) {
      throw new EnsembleError(
        `That is ${(steps + 1).toLocaleString('en')} steps × ${inst.nodeIds.length} kernel nodes: too large an envelope to hold. Lengthen the step or shorten the run.`
      );
    }
    inst.setSeed(opts.seed);
    const seed = inst.seed;
    const stride = Math.max(1, Math.ceil(steps / (MAX_SAMPLES - 1)));
    const picks: number[] = [];
    for (let s = 0; s <= steps; s += stride) picks.push(s);
    if (picks[picks.length - 1] !== steps) picks.push(steps);
    const cols = columnsFor(model, inst);
    const result = inst.ensemble(runs, opts.perturbation, (v) => {
      const last = v.steps - 1;
      const nodes = model.nodes.flatMap((n): EnsembleSeries[] => {
        const c = cols.get(n.id);
        if (c === undefined || c >= v.nodes) return [];
        const read = (get: (s: number, n: number) => number) =>
          Float64Array.from(picks, (s) => get(Math.min(s, last), c));
        return [
          {
            id: n.id,
            label: n.visual.label ?? n.id,
            min: read(v.min),
            mean: read(v.mean),
            max: read(v.max),
          },
        ];
      });
      return nodes;
    });
    return {
      manifest: {
        kernelVersion: kernel.info.version,
        kernelSha256: kernel.info.sha256,
        modelHash,
        method: model.config.method,
        t_start: t0,
        t_end: inst.tEnd,
        dt,
        steps,
        samples: picks.length,
        seed,
        runs,
        perturbation: opts.perturbation,
      },
      times: Float64Array.from(picks, (s) => t0 + s * dt),
      nodes: result,
      elapsedMs: performance.now() - started,
    };
  } finally {
    inst.free();
  }
}
