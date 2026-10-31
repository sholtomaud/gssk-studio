/**
 * The `script` worker (ADR 0013): runs one compiled Energese script and
 * returns the model it synthesizes. A fresh worker per run, terminated after,
 * so a runaway script ends with it.
 *
 * In the production build the worker is started from a Blob URL, so it
 * inherits the page's Content-Security-Policy: `script-src` stops a script
 * importing code from anywhere else. The page's `connect-src` also lists the
 * assistant's providers (ADR 0016), localhost among them, so a script's way
 * out is closed here: every network API is replaced, before the script loads,
 * by a stub it cannot put back, and it cannot start a worker of its own (which
 * would get fresh ones).
 */
import { executeScript, type ExecuteRequest } from '../code/execute.ts';
import type { StudioModel } from '../model/types.ts';
import { expose, type Endpoint } from './rpc.ts';

const offline = (what: string) => () => {
  throw new Error(`${what}: a script has no network (ADR 0013).`);
};
const seal = (target: object, name: string, value: unknown) =>
  Object.defineProperty(target, name, { value, writable: false, configurable: false });
seal(globalThis, 'fetch', () =>
  Promise.reject(new Error('fetch: a script has no network (ADR 0013).'))
);
for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker'])
  seal(globalThis, name, offline(name));
if ('sendBeacon' in navigator) seal(navigator, 'sendBeacon', offline('sendBeacon'));

export interface ScriptLog {
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
}

export type ScriptResult =
  | { ok: true; model: StudioModel; logs: ScriptLog[]; durationMs: number }
  | { ok: false; message: string; logs: ScriptLog[] };

const logs: ScriptLog[] = [];

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a) ?? String(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

for (const level of ['log', 'info', 'warn', 'error'] as const) {
  console[level] = (...args: unknown[]) => void logs.push({ level, text: format(args) });
}

const blobUrl = (path: string, code: string) =>
  URL.createObjectURL(new Blob([`${code}\n//# sourceURL=${path}`], { type: 'text/javascript' }));

const api = {
  execute: async (req: ExecuteRequest): Promise<ScriptResult> => {
    const t0 = performance.now();
    try {
      const model = await executeScript(req, blobUrl);
      return { ok: true, model, logs, durationMs: performance.now() - t0 };
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      return { ok: false, message, logs };
    }
  },
};

export type ScriptApi = typeof api;

expose(api, self as unknown as Endpoint);
