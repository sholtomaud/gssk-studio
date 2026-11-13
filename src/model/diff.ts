/**
 * What a proposed model changes against the model it began from (ADR 0016),
 * by symbol and flow id, so the canvas can draw a proposal with what is new
 * or different picked out, and the card can say what goes.
 */
import type { StudioModel } from './types.ts';

export interface ProposedChanges {
  /** Symbols and flows only in the proposal. */
  added: string[];
  /** In both, but different (a value, a rate, a position). */
  changed: string[];
  /** Only in the model it began from. */
  removed: string[];
}

export function proposedChanges(base: StudioModel, draft: StudioModel): ProposedChanges {
  const out: ProposedChanges = { added: [], changed: [], removed: [] };
  const compare = <T extends { id: string }>(was: readonly T[], now: readonly T[]) => {
    const before = new Map(was.map((x) => [x.id, x]));
    for (const x of now) {
      const old = before.get(x.id);
      if (!old) out.added.push(x.id);
      else if (old !== x && JSON.stringify(old) !== JSON.stringify(x)) out.changed.push(x.id);
      before.delete(x.id);
    }
    out.removed.push(...before.keys());
  };
  compare(base.nodes, draft.nodes);
  compare(base.edges, draft.edges);
  return out;
}
