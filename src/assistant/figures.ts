/**
 * No made-up figures (NFR-HON-002, ADR 0016): a number in the assistant's
 * reply must appear in a tool result of that turn, in the person's message,
 * or in the model it was given. Anything else is flagged, struck through,
 * with a note, as budget-app does. Small whole numbers (counts, list
 * positions) and the COICOP codes are left alone.
 */

const NUMBER = /(?<![\w.])-?\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?%?(?![\w])/gi;

function value(token: string): number | undefined {
  const v = Number(token.replace(/,/g, '').replace(/%$/, ''));
  return Number.isFinite(v) ? v : undefined;
}

/** Every number in some text. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const v = value(m[0]);
    if (v !== undefined) out.push(v);
  }
  return out;
}

const close = (a: number, b: number) =>
  a === b || Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.005;

/** A quote of a source number within 0.5 % counts: 1,234.567 may be said as 1,235. */
function supported(v: number, sources: readonly number[]): boolean {
  if (Number.isInteger(v) && Math.abs(v) <= 12) return true;
  return sources.some((s) => close(v, s) || close(Math.abs(v), Math.abs(s)));
}

export interface Part {
  text: string;
  /** True for a figure no source supports. */
  flagged: boolean;
}

/** Split a reply into plain text and figures, flagging those no source supports. */
export function checkFigures(reply: string, sources: readonly string[]): Part[] {
  const known = sources.flatMap(numbersIn);
  const parts: Part[] = [];
  let last = 0;
  for (const m of reply.matchAll(NUMBER)) {
    const v = value(m[0]);
    if (v === undefined || supported(v, known)) continue;
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: reply.slice(last, at), flagged: false });
    parts.push({ text: m[0], flagged: true });
    last = at + m[0].length;
  }
  if (last < reply.length) parts.push({ text: reply.slice(last), flagged: false });
  return parts;
}
