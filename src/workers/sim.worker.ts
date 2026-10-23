/**
 * The `sim` worker (SPEC §4). Verifies the pinned kernel against its SHA-256
 * before instantiating it (NFR-KER-001) and runs models off the UI thread.
 */
import wasmUrl from '../../vendor/gssk/gssk.wasm?url';
import pinJson from '../../vendor/gssk/GSSK_PIN.json' with { type: 'json' };
import { GsskKernel, type GsskPin, type KernelInfo } from '../sim/gssk.ts';
import { runModel, type RunResult } from '../sim/run.ts';
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

const api = {
  async kernelInfo(): Promise<KernelInfo> {
    return (await getKernel()).info;
  },
  async run(model: StudioModel): Promise<RunResult> {
    return runModel(await getKernel(), model);
  },
};

export type SimApi = typeof api;

expose(api, self as unknown as Endpoint);
