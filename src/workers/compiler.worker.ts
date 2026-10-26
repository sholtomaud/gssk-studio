/**
 * The `compiler` worker (ADR 0011): tsrs, a Rust port of the TypeScript 7
 * compiler, type-checks and emits a script off the UI thread. After
 * tsrs-monaco (MIT). Its checker recurses deeply, and a worker's stack is
 * larger than the page's.
 */
import { loadModule, tsc } from '@tsrs/wasm';
import wasmUrl from '@tsrs/wasm/tsrs.wasm?url';
import type { TsrsDiagnostic } from '../code/diagnostics.ts';
import { PROJECT_ROOT, projectFiles, toAbsolute, toRelative } from '../code/project.ts';
import { expose, type Endpoint } from './rpc.ts';

/** Compiled once; tsc instantiates it fresh for each check. */
const module = Promise.resolve(loadModule(wasmUrl));

export interface CompileResult {
  diagnostics: TsrsDiagnostic[];
  /** Emitted JavaScript, keyed by project-relative path. */
  modules: Record<string, string>;
  durationMs: number;
}

/** Checks run one at a time, so memory stays bounded when edits outpace checks. */
let queue: Promise<unknown> = Promise.resolve();

const api = {
  ready: async (): Promise<true> => {
    await module;
    return true;
  },
  compile: (script: string): Promise<CompileResult> => {
    const job = queue.then(async () => {
      const t0 = performance.now();
      const result = await tsc(['-p', toAbsolute('tsconfig.json')], {
        cwd: PROJECT_ROOT,
        files: projectFiles(script),
        diagnostics: 'json',
        module: await module,
      });
      const modules: Record<string, string> = {};
      for (const [path, text] of Object.entries(result.files ?? {})) {
        if (!path.includes('/node_modules/')) modules[toRelative(path)] = text;
      }
      return {
        diagnostics: (result.diagnostics ?? []) as TsrsDiagnostic[],
        modules,
        durationMs: performance.now() - t0,
      };
    });
    queue = job.catch(() => undefined);
    return job;
  },
};

export type CompilerApi = typeof api;

expose(api, self as unknown as Endpoint);
