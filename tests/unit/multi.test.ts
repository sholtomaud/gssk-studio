import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import {
  alignNodes,
  copyFragment,
  distributeNodes,
  moveNodes,
  pasteFragment,
  pruneSelection,
  removeSelection,
  selectedNodeIds,
  selectionKey,
  selectNodes,
} from '../../src/model/ops.ts';
import { validate } from '../../src/model/validate.ts';

const grass = () => structuredClone(EXAMPLES[0]!.model);

describe('several symbols at once (FR-EDIT-011, FR-EDIT-012)', () => {
  it('builds selections from ids: none, one, several', () => {
    expect(selectNodes([])).toBeNull();
    expect(selectNodes(['a', 'a'])).toEqual({ kind: 'node', id: 'a' });
    expect(selectNodes(['a', 'b'])).toEqual({ kind: 'nodes', ids: ['a', 'b'] });
    expect(selectionKey({ kind: 'nodes', ids: ['b', 'a'] })).toBe(
      selectionKey({ kind: 'nodes', ids: ['a', 'b'] })
    );
    expect(selectedNodeIds({ kind: 'edge', id: 'x' })).toEqual([]);
  });

  it('drops what the model no longer has', () => {
    const m = grass();
    expect(pruneSelection(m, { kind: 'nodes', ids: ['sun', 'ghost'] })).toEqual({
      kind: 'node',
      id: 'sun',
    });
    expect(pruneSelection(m, { kind: 'edge', id: 'ghost' })).toBeNull();
  });

  it('moves and deletes several nodes, with their flows', () => {
    const m = grass();
    const moved = moveNodes(m, ['sun', 'grass'], 10, -20);
    expect(moved.nodes[0]?.visual).toMatchObject({ x: 110, y: 240 });
    expect(moved.nodes[2]?.visual).toEqual(m.nodes[2]?.visual);
    const after = removeSelection(m, { kind: 'nodes', ids: ['sun', 'grass'] });
    expect(after.nodes.map((n) => n.id)).toEqual(['grazers', 'heat']);
    expect(after.edges.map((e) => e.id)).toEqual(['grazer_loss']);
  });

  it('copies nodes with the flows between them and pastes them with fresh ids', () => {
    const m = grass();
    const frag = copyFragment(m, ['grass', 'grazers']);
    expect(frag.edges.map((e) => e.id)).toEqual(['grazing']);
    const { model, ids } = pasteFragment(m, frag, { x: 40, y: 40 });
    expect(ids).toEqual(['grass_2', 'grazers_2']);
    const copy = model.edges.at(-1);
    // The copied flow joins the copies, and its control follows the copy.
    expect(copy).toMatchObject({
      origin: 'grass_2',
      target: 'grazers_2',
      params: { control_node: 'grazers_2' },
    });
    expect(model.nodes.find((n) => n.id === 'grass_2')?.visual).toMatchObject({ x: 370, y: 300 });
    expect(validate(model).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('keeps a control outside the copy pointing at the original, or drops it if gone', () => {
    const m = grass();
    const frag = copyFragment(m, ['grass', 'heat']);
    frag.edges[0]!.params.control_node = 'sun';
    expect(pasteFragment(m, frag, { x: 0, y: 0 }).model.edges.at(-1)?.params.control_node).toBe(
      'sun'
    );
    const without = removeSelection(m, { kind: 'node', id: 'sun' });
    expect(
      pasteFragment(without, frag, { x: 0, y: 0 }).model.edges.at(-1)?.params.control_node
    ).toBeUndefined();
  });

  it('aligns and distributes centres', () => {
    const m = grass();
    const top = alignNodes(m, ['sun', 'heat'], 'top');
    expect(top.nodes.find((n) => n.id === 'heat')?.visual.y).toBe(260);
    const left = alignNodes(m, ['sun', 'grass', 'grazers'], 'left');
    expect(new Set(left.nodes.slice(0, 3).map((n) => n.visual.x))).toEqual(new Set([100]));
    const spread = distributeNodes(
      moveNodes(m, ['grass'], 200, 0),
      ['sun', 'grass', 'grazers'],
      'x'
    );
    expect(spread.nodes.slice(0, 3).map((n) => n.visual.x)).toEqual([100, 340, 580]);
    expect(alignNodes(m, ['sun'], 'top')).toBe(m);
  });
});
