import { describe, expect, it } from 'vitest';
import { exampleById } from '../../src/model/examples/index.ts';
import { addNode, moveNode, removeEdge, updateEdge } from '../../src/model/ops.ts';
import { proposedChanges } from '../../src/model/diff.ts';
import { cloneModel } from '../../src/model/types.ts';

describe('what a proposal changes, for its preview on the canvas (ADR 0016)', () => {
  const base = cloneModel(exampleById('grassland')!.model);

  it('lists added and changed symbols and flows, and what it removes', () => {
    const flow = base.edges[0]!;
    let draft = addNode(base, 'storage', { x: 900, y: 900 }, 'Seed bank').model;
    draft = updateEdge(draft, flow.id, (e) => (e.params.k = e.params.k * 2));
    const gone = base.edges[1]!.id;
    draft = removeEdge(draft, gone);
    const c = proposedChanges(base, draft);
    expect(c.added).toContain('seed_bank');
    expect(c.changed).toContain(flow.id);
    expect(c.removed).toContain(gone);
    expect(c.added).not.toContain(flow.id);
  });

  it('counts a move as a change, and the same model as none', () => {
    const n = base.nodes[0]!;
    const moved = moveNode(base, n.id, { x: n.visual.x + 40, y: n.visual.y });
    expect(proposedChanges(base, moved).changed).toEqual([n.id]);
    expect(proposedChanges(base, cloneModel(base))).toEqual({
      added: [],
      changed: [],
      removed: [],
    });
  });
});
