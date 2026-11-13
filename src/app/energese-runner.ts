/**
 * The assistant's `propose_energese` (ADR 0016) on the code view's own
 * machinery (ADR 0013): tsrs checks the script, the sandboxed script worker
 * runs it, and the model it builds keeps the script as its provenance
 * (FR-SDK-007), exactly as Apply in the code view does. The compiler and the
 * script worker load on first use, so the studio's first load is unchanged.
 */
import type { EnergeseOutcome } from '../assistant/tools.ts';
import { toProblem } from '../code/diagnostics.ts';
import { SCRIPT } from '../code/project.ts';
import { normaliseModel } from '../model/io.ts';
import { kernelHash } from '../model/kernel-json.ts';
import type { StudioModel } from '../model/types.ts';
import { toEnergese } from '../sdk/energese/codegen.ts';

export async function runEnergese(source: string, previous: StudioModel): Promise<EnergeseOutcome> {
  const { compile, runScript } = await import('./code-client.ts');
  const compiled = await compile(source);
  const errors = compiled.diagnostics
    .map(toProblem)
    .filter((p) => p.severity === 'error')
    .map(
      (p) =>
        `${p.file && p.file !== SCRIPT ? `${p.file} ` : ''}${p.startLineNumber}:${p.startColumn} ${p.message}`
    );
  if (errors.length) return { ok: false, problems: errors, logs: [] };
  const r = await runScript({ modules: compiled.modules, previous });
  const logs = r.logs.map((l) => (l.level === 'log' ? l.text : `${l.level}: ${l.text}`));
  if (!r.ok) return { ok: false, problems: [r.message], logs };
  const { model, notes } = normaliseModel(r.model);
  delete model._energese;
  if (toEnergese(model) !== source)
    model._energese = { source, modelHash: await kernelHash(model) };
  return { ok: true, model, logs: [...logs, ...notes] };
}
