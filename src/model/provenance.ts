/**
 * Who set each input value (NFR-HON-002, ADR 0016). An LLM never produces a
 * result, but the assistant may set an input (a rate, an initial value, a
 * capacity) when it is marked. The mark lives in `_provenance`, keyed by the
 * input, beside the model: editor-only, so the kernel never sees it and the
 * model hash is unchanged.
 *
 * A mark is replaced, never cleared silently: a hand edit of a marked value
 * marks it `user`; calibration marks it `calibration`.
 */
import type { ModelEdge, ModelNode, Provenance, StudioModel } from './types.ts';

/** An input a mark can name: a node's value or capacity, or a node's or flow's parameter. */
export type InputField = 'value' | 'capacity' | `params.${string}`;

export function inputKey(kind: 'node' | 'edge', id: string, field: InputField): string {
  return `${kind}:${id}:${field}`;
}

function parseKey(key: string): { kind: 'node' | 'edge'; id: string; field: string } | undefined {
  const m = /^(node|edge):([^:]+):(.+)$/.exec(key);
  return m ? { kind: m[1] as 'node' | 'edge', id: m[2]!, field: m[3]! } : undefined;
}

/** The value an input key names, or undefined when it is gone. */
export function inputValue(m: StudioModel, key: string): unknown {
  const k = parseKey(key);
  if (!k) return undefined;
  const target: ModelNode | ModelEdge | undefined =
    k.kind === 'node' ? m.nodes.find((n) => n.id === k.id) : m.edges.find((e) => e.id === k.id);
  if (!target) return undefined;
  if (k.field === 'value') return 'value' in target ? target.value : undefined;
  if (k.field === 'capacity')
    return 'visual' in target ? (target as ModelNode).visual.capacity : undefined;
  if (k.field.startsWith('params.')) {
    const params = target.params as Record<string, unknown> | undefined;
    return params?.[k.field.slice(7)];
  }
  return undefined;
}

export function marksOf(m: StudioModel): Readonly<Record<string, Provenance>> {
  return m._provenance ?? {};
}

/** The marks on one node or flow, by field. */
export function marksFor(
  m: StudioModel,
  kind: 'node' | 'edge',
  id: string
): { field: string; mark: Provenance }[] {
  const prefix = `${kind}:${id}:`;
  return Object.entries(marksOf(m))
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, mark]) => ({ field: k.slice(prefix.length), mark }));
}

/** Mark inputs, in place on a model being built (the assistant's draft). */
export function markInputs(m: StudioModel, keys: readonly string[], mark: Provenance): void {
  if (keys.length === 0) return;
  m._provenance = { ...m._provenance };
  for (const k of keys) m._provenance[k] = { ...mark };
}

/** How many inputs the assistant set and nobody has replaced: counted in each run's manifest. */
export function assumedCount(m: StudioModel): number {
  return Object.entries(marksOf(m)).filter(
    ([k, p]) => p.by === 'assistant' && inputValue(m, k) !== undefined
  ).length;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * After an edit that is not the assistant's: a marked value that changed and
 * whose mark the edit did not set itself is now `by`'s (a hand edit or
 * calibration). Marks on inputs that are gone are dropped. Returns `next`
 * unchanged (the same object) when nothing needs doing.
 */
export function reconcileMarks(
  prev: StudioModel,
  next: StudioModel,
  by: 'user' | 'calibration',
  at = new Date().toISOString()
): StudioModel {
  const marks = next._provenance;
  if (!marks) return next;
  let out: Record<string, Provenance> | null = null;
  for (const [k, mark] of Object.entries(marks)) {
    const now = inputValue(next, k);
    const gone = now === undefined;
    const replaced = !gone && same(prev._provenance?.[k], mark) && !same(inputValue(prev, k), now);
    if (!gone && !replaced) continue;
    out ??= { ...marks };
    if (gone) delete out[k];
    else out[k] = { by, at };
  }
  if (!out) return next;
  const result = { ...next };
  if (Object.keys(out).length) result._provenance = out;
  else delete result._provenance;
  return result;
}

/** Follow a node's rename. */
export function renameMarks(m: StudioModel, from: string, to: string): void {
  if (!m._provenance) return;
  const prefix = `node:${from}:`;
  const out: Record<string, Provenance> = {};
  for (const [k, v] of Object.entries(m._provenance))
    out[k.startsWith(prefix) ? `node:${to}:${k.slice(prefix.length)}` : k] = v;
  m._provenance = out;
}
