/**
 * The UI's handles on the code view's workers (ADR 0013): one long-lived
 * compiler, restarted if tsrs takes it down, and a fresh script worker per
 * run, ended after it or when it runs too long.
 */
import type { ExecuteRequest } from '../code/execute.ts';
import type { CompileResult, CompilerApi } from '../workers/compiler.worker.ts';
import type { ScriptApi, ScriptResult } from '../workers/script.worker.ts';
import { wrap, type Remote } from '../workers/rpc.ts';
import scriptWorkerUrl from '../workers/script.worker.ts?worker&url';

/** A script that has not finished by then is stopped. */
export const SCRIPT_TIMEOUT_MS = 10_000;

let compiler: { worker: Worker; api: Remote<CompilerApi>; crashed: Promise<never> } | null = null;

function startCompiler() {
  const worker = new Worker(new URL('../workers/compiler.worker.ts', import.meta.url), {
    type: 'module',
    name: 'compiler',
  });
  // A trap (a stack overflow in the checker) can take the worker down: fail
  // what was in flight, and start a new one on the next call.
  const crashed = new Promise<never>((_resolve, reject) => {
    worker.addEventListener('error', (e) => {
      e.preventDefault();
      if (compiler?.worker === worker) compiler = null;
      worker.terminate();
      reject(new Error(e.message || 'The TypeScript compiler stopped.'));
    });
  });
  crashed.catch(() => undefined);
  return { worker, api: wrap<CompilerApi>(worker), crashed };
}

function getCompiler() {
  compiler ??= startCompiler();
  return compiler;
}

/** Resolves once tsrs.wasm is loaded and compiled. */
export function compilerReady(): Promise<true> {
  const c = getCompiler();
  return Promise.race([c.api.ready(), c.crashed]);
}

export function compile(script: string): Promise<CompileResult> {
  const c = getCompiler();
  return Promise.race([c.api.compile(script), c.crashed]);
}

/**
 * The worker for one run. Built, it starts from a Blob URL so it inherits the
 * page's CSP (ADR 0013); in development it starts from its module URL.
 */
async function scriptWorker(): Promise<{ worker: Worker; url?: string }> {
  if (import.meta.env.DEV) {
    return { worker: new Worker(scriptWorkerUrl, { type: 'module', name: 'script' }) };
  }
  const res = await fetch(scriptWorkerUrl);
  if (!res.ok) throw new Error(`script worker: HTTP ${res.status}`);
  const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
  return { worker: new Worker(url, { type: 'module', name: 'script' }), url };
}

export async function runScript(req: ExecuteRequest): Promise<ScriptResult> {
  const { worker, url } = await scriptWorker();
  let timer = 0;
  try {
    return await Promise.race([
      wrap<ScriptApi>(worker).execute(req),
      new Promise<ScriptResult>((resolve) => {
        worker.addEventListener('error', (e) => {
          e.preventDefault();
          resolve({ ok: false, message: e.message || 'The script stopped.', logs: [] });
        });
        timer = window.setTimeout(
          () =>
            resolve({
              ok: false,
              message: `The script ran for more than ${SCRIPT_TIMEOUT_MS / 1000} s and was stopped.`,
              logs: [],
            }),
          SCRIPT_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
    worker.terminate();
    if (url) URL.revokeObjectURL(url);
  }
}
