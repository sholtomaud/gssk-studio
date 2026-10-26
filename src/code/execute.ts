/**
 * Running a compiled script (ADR 0011, ADR 0013): link its modules, import
 * the entry, and synthesize the model it default-exports. The SDK a script
 * imports is this module's own copy, handed over through a global registry,
 * so the script's `Model` is the class `instanceof` checks here. The script
 * worker calls this with Blob URLs; tests call it with data: URLs.
 */
import type { StudioModel } from '../model/types.ts';
import * as energese from '../sdk/energese/index.ts';
import * as builder from '../sdk/gssk/builder.ts';
import { link, type Modules } from './module-graph.ts';
import { SCRIPT_JS } from './project.ts';

const REGISTRY = 'gssk-studio.sdk';
const SDK: Record<string, Record<string, unknown>> = {
  energese,
  '@gssk/builder': builder,
};

export class ScriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptError';
  }
}

type ToUrl = (path: string, code: string) => string;

/** A module per SDK package that re-exports the registered namespace. */
function sdkModules(toUrl: ToUrl): Record<string, string> {
  (globalThis as Record<symbol, unknown>)[Symbol.for(REGISTRY)] = SDK;
  return Object.fromEntries(
    Object.entries(SDK).map(([spec, ns]) => {
      const names = Object.keys(ns).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default');
      const code =
        `const ns = globalThis[Symbol.for(${JSON.stringify(REGISTRY)})][${JSON.stringify(spec)}];\n` +
        `export const { ${names.join(', ')} } = ns;\n`;
      return [spec, toUrl(`sdk:${spec}`, code)];
    })
  );
}

export interface ExecuteRequest {
  /** Emitted JavaScript, keyed by project-relative path. */
  modules: Modules;
  previous?: StudioModel;
}

export async function executeScript(req: ExecuteRequest, toUrl: ToUrl): Promise<StudioModel> {
  const url = link(req.modules, SCRIPT_JS, toUrl, sdkModules(toUrl));
  const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown };
  if (!(mod.default instanceof builder.GsskModel)) {
    throw new ScriptError(
      'The script must default-export its model: `const m = new ener.Model(…)`, then `export default m;`.'
    );
  }
  return mod.default.synth(req.previous ? { previous: req.previous } : {});
}

/** A data: URL for a module, for runtimes without Blob URLs (Node, in tests). */
export function dataUrl(_path: string, code: string): string {
  let binary = '';
  for (const b of new TextEncoder().encode(code)) binary += String.fromCharCode(b);
  return `data:text/javascript;base64,${btoa(binary)}`;
}
