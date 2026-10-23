/** The UI's handle on the sim worker (SPEC §4). One worker, started on first use. */
import { wrap, type Remote } from '../workers/rpc.ts';
import type { SimApi } from '../workers/sim.worker.ts';

let sim: Remote<SimApi> | null = null;

export function simWorker(): Remote<SimApi> {
  sim ??= wrap<SimApi>(
    new Worker(new URL('../workers/sim.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sim',
    })
  );
  return sim;
}
