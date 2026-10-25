/**
 * The `sim` worker (SPEC §4). Verifies the pinned kernel against its SHA-256
 * before instantiating it (NFR-KER-001) and runs models off the UI thread.
 */
import wasmUrl from '../../vendor/gssk/gssk.wasm?url';
import pinJson from '../../vendor/gssk/GSSK_PIN.json' with { type: 'json' };
import { GsskKernel, type GsskPin, type KernelInfo } from '../sim/gssk.ts';
import { RunSession, runModel, type RunResult } from '../sim/run.ts';
import type { StudioModel } from '../model/types.ts';
import { expose, type Endpoint } from './rpc.ts';

const pin = pinJson as GsskPin;
let kernel: Promise<GsskKernel> | null = null;

function getKernel(): Promise<GsskKernel> {
  kernel ??= (async () => {
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error(`gssk.wasm: HTTP ${res.status}`);
    return GsskKernel.load(await res.arrayBuffer(), pin);
  })();
  // A failed load is not cached, so a retry fetches again.
  kernel.catch(() => (kernel = null));
  return kernel;
}

/**
 * The run in progress (FR-SIM-005). One at a time: starting a run closes any
 * other, so a run abandoned by a closed screen cannot leak its instance.
 */
let session: { token: number; run: RunSession } | null = null;
let nextToken = 1;

function current(token: number): RunSession {
  if (!session || session.token !== token) throw new Error('That run was cancelled or replaced.');
  return session.run;
}

export interface RunProgress {
  step: number;
  steps: number;
  done: boolean;
}

const api = {
  async kernelInfo(): Promise<KernelInfo> {
    return (await getKernel()).info;
  },
  async run(model: StudioModel): Promise<RunResult> {
    return runModel(await getKernel(), model);
  },
  /** Start a run to advance in chunks; returns its token and step count. */
  async begin(model: StudioModel): Promise<{ token: number; steps: number }> {
    const run = await RunSession.start(await getKernel(), model);
    session?.run.close();
    session = { token: nextToken++, run };
    return { token: session.token, steps: run.steps };
  },
  /** Step for about `budgetMs`, then report where the run is. */
  advance(token: number, budgetMs: number): RunProgress {
    const run = current(token);
    const step = run.advance(budgetMs);
    return { step, steps: run.steps, done: run.done };
  },
  finish(token: number): RunResult {
    const result = current(token).result();
    session = null;
    return result;
  },
  cancel(token: number): void {
    if (session?.token === token) {
      session.run.close();
      session = null;
    }
  },
};

export type SimApi = typeof api;

expose(api, self as unknown as Endpoint);
