/**
 * Minimal typed RPC over postMessage, for the UI ↔ worker boundary (SPEC §4).
 * Each call is a request with an id; the worker replies with a value or an
 * error. Arguments and results must be structured-cloneable.
 */

/** Anything that can send and receive messages: a Worker, a worker's global scope, a MessagePort. */
export interface Endpoint {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  start?: () => void;
}

/** Any function: `never[]` parameters accept every signature without `any`. */
type AnyFn = (...args: never[]) => unknown;

/** The caller's view of an API: every method returns a promise. */
export type Remote<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never;
};

interface Request {
  rpc: 'call';
  id: number;
  method: string;
  args: unknown[];
}

type Reply =
  | { rpc: 'reply'; id: number; ok: true; value: unknown }
  | { rpc: 'reply'; id: number; ok: false; name: string; message: string };

/** Serve `api` on `endpoint` (in a worker: `expose(api, self)`). */
export function expose(api: Record<string, AnyFn>, endpoint: Endpoint): void {
  endpoint.addEventListener('message', (event) => {
    const req = event.data as Request;
    if (req?.rpc !== 'call') return;
    const fn = Object.hasOwn(api, req.method) ? api[req.method] : undefined;
    Promise.resolve()
      .then(() => {
        if (!fn) throw new Error(`No RPC method "${req.method}"`);
        return fn(...(req.args as never[]));
      })
      .then(
        (value) =>
          endpoint.postMessage({ rpc: 'reply', id: req.id, ok: true, value } satisfies Reply),
        (err: unknown) => {
          const e = err instanceof Error ? err : new Error(String(err));
          endpoint.postMessage({
            rpc: 'reply',
            id: req.id,
            ok: false,
            name: e.name,
            message: e.message,
          } satisfies Reply);
        }
      );
  });
  endpoint.start?.();
}

/** A typed proxy for an API exposed on `endpoint` (on the UI side: `wrap<Api>(worker)`). */
export function wrap<T>(endpoint: Endpoint): Remote<T> {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  endpoint.addEventListener('message', (event) => {
    const reply = event.data as Reply;
    if (reply?.rpc !== 'reply') return;
    const p = pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    if (reply.ok) {
      p.resolve(reply.value);
    } else {
      const err = new Error(reply.message);
      err.name = reply.name;
      p.reject(err);
    }
  });
  endpoint.start?.();

  return new Proxy({} as Remote<T>, {
    get(_target, method) {
      if (typeof method !== 'string' || method === 'then') return undefined;
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          endpoint.postMessage({ rpc: 'call', id, method, args } satisfies Request);
        });
    },
  });
}
