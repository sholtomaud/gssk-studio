import { describe, expect, it } from 'vitest';
import {
  blockFromGroup,
  blockHash,
  blockIssues,
  groupPorts,
  metaProblems,
  parseBlock,
  placeBlock,
  serialiseBlock,
  type Block,
} from '../../src/model/blocks.ts';
import { exampleById } from '../../src/model/examples/index.ts';
import { groupNodes, nodesIn } from '../../src/model/groups.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { connect, updateEdge } from '../../src/model/ops.ts';
import { cloneModel, emptyModel } from '../../src/model/types.ts';
import { validate } from '../../src/model/validate.ts';
import { ModelFormatError } from '../../src/model/io.ts';

/** The budget example, its money declared as Australian dollars. */
const budget = () => {
  const m = cloneModel(exampleById('budget')!.model);
  m.carriers = [{ id: 'aud', _label: 'Australian dollar', _currency: 'AUD' }];
  for (const e of m.edges) e.carrier = 'aud';
  return m;
};
const meta = { id: 'test.expenses', version: '1.0.0', title: 'Expenses' };

function expenses(): Block {
  return blockFromGroup(budget(), 'expenses', meta).block;
}

describe('building blocks (ADR 0017)', () => {
  it('a group’s ports are the symbols inside that flows across its edge reach', () => {
    const m = budget();
    const ports = groupPorts(m, 'expenses');
    const inside = new Set(nodesIn(m, 'expenses'));
    expect(ports.length).toBeGreaterThan(0);
    expect(ports.every((p) => inside.has(p.node) && p.direction === 'in')).toBe(true);
    const crossing = m.edges.filter((e) => !inside.has(e.origin) && inside.has(e.target));
    expect(new Set(ports.map((p) => p.node))).toEqual(new Set(crossing.map((e) => e.target)));
    expect(ports[0]?.carrier).toBe(crossing[0]?.carrier);
  });

  it('saves what a group holds, drawn around its centre, with its inner groups', () => {
    const m = budget();
    const b = expenses();
    const inside = nodesIn(m, 'expenses');
    expect(b.model.nodes.map((n) => n.id).sort()).toEqual([...inside].sort());
    expect(b.model.edges.every((e) => inside.includes(e.origin) && inside.includes(e.target))).toBe(
      true
    );
    expect(b.model._diagram.groups?.map((g) => g.id).sort()).toEqual([
      'comms',
      'housing',
      'living',
      'renewals',
    ]);
    expect(b.model._diagram.groups?.every((g) => g.parent === undefined)).toBe(true);
    const xs = b.model.nodes.map((n) => n.visual.x);
    expect(Math.round((Math.min(...xs) + Math.max(...xs)) / 2)).toBe(0);
    // The carriers it keeps are the ones its symbols, flows and ports name.
    const named = new Set(
      [...b.model.nodes, ...b.model.edges, ...b.ports].map((x) => x.carrier).filter(Boolean)
    );
    expect(b.model.carriers?.map((c) => c.id)).toEqual([...named]);
  });

  it('round-trips through its file and hashes the same', async () => {
    const b = expenses();
    const back = parseBlock(serialiseBlock(b));
    expect(back.notes).toEqual([]);
    expect(back.block).toEqual(b);
    expect(await blockHash(back.block)).toBe(await blockHash(b));
    const changed = structuredClone(b);
    changed.model.nodes[0]!.value += 1;
    expect(await blockHash(changed)).not.toBe(await blockHash(b));
  });

  it('refuses a file that is not a block', () => {
    expect(() => parseBlock(serialiseModel(budget()))).toThrow(ModelFormatError);
    const b = JSON.parse(serialiseBlock(expenses())) as Record<string, unknown>;
    expect(() => parseBlock(JSON.stringify({ ...b, version: 'one' }))).toThrow(/version/);
    expect(() => parseBlock(JSON.stringify({ ...b, format_version: 9 }))).toThrow(/format version/);
  });

  it('checks an id and version before saving', () => {
    expect(metaProblems(meta)).toEqual([]);
    expect(metaProblems({ id: 'Au Households', version: '1', title: ' ' })).toHaveLength(3);
  });

  it('places a copy with fresh ids, as a packed group that remembers the block', async () => {
    const m = budget();
    const b = expenses();
    const hash = await blockHash(b);
    const { model, groupId } = placeBlock(m, b, { x: 1000, y: 200 }, hash);
    expect(model.nodes).toHaveLength(m.nodes.length + b.model.nodes.length);
    expect(new Set(model.nodes.map((n) => n.id)).size).toBe(model.nodes.length);
    expect(new Set(model.edges.map((e) => e.id)).size).toBe(model.edges.length);
    const g = model._diagram.groups!.find((x) => x.id === groupId)!;
    expect(g.collapsed).toBe(true);
    expect(g.block).toMatchObject({ id: 'test.expenses', version: '1.0.0', hash });
    const placed = new Set(nodesIn(model, groupId));
    expect(placed.size).toBe(b.model.nodes.length);
    expect(g.block!.ports.every((p) => placed.has(p.node))).toBe(true);
    // Nested groups came along inside it; the carriers are shared, not duplicated.
    expect(model._diagram.groups!.filter((x) => x.parent === groupId)).toHaveLength(4);
    expect(model.carriers).toEqual(m.carriers);
    // Its edges join only its own symbols.
    const added = model.edges.slice(m.edges.length);
    expect(added.every((e) => placed.has(e.origin) && placed.has(e.target))).toBe(true);
    // A file keeps the record.
    const back = parseModel(serialiseModel(model)).model;
    expect(back._diagram.groups!.find((x) => x.id === groupId)?.block).toEqual(g.block);
    expect(validate(model).filter((i) => i.severity === 'error')).toEqual(
      validate(m).filter((i) => i.severity === 'error')
    );
  });

  it('renames a carrier that means something else in the model it is placed in', () => {
    const b = expenses();
    const m = emptyModel();
    const id = b.model.carriers![0]!.id;
    m.carriers = [{ id, unit: 'kg' }];
    const { model, groupId } = placeBlock(m, b, { x: 0, y: 0 }, 'h');
    expect(model.carriers!.map((c) => c.id)).toContain(`${id}_2`);
    const g = model._diagram.groups!.find((x) => x.id === groupId)!;
    expect(g.block!.ports.every((p) => p.carrier === `${id}_2`)).toBe(true);
  });

  it('checks flows wired to a placed block against its ports', () => {
    const b = expenses();
    let { model, groupId } = placeBlock(emptyModel(), b, { x: 0, y: 0 }, 'h');
    const g = model._diagram.groups!.find((x) => x.id === groupId)!;
    const port = g.block!.ports[0]!;
    // Only the first symbol is a port, so the others are not.
    g.block!.ports = [{ ...port, direction: 'in' }];
    const notPort = nodesIn(model, groupId).find((n) => n !== port.node)!;
    model = {
      ...model,
      nodes: [...model.nodes, { id: 'bank', type: 'storage', value: 1, visual: { x: -400, y: 0 } }],
    };
    model = connect(model, 'bank', port.node).model;
    const e1 = model.edges.at(-1)!.id;
    model = updateEdge(model, e1, (e) => (e.carrier = port.carrier));
    expect(blockIssues(model)).toEqual([]);
    model = updateEdge(model, e1, (e) => delete e.carrier);
    expect(blockIssues(model).map((i) => i.code)).toEqual(['block-port-carrier']);
    model = updateEdge(model, e1, (e) => (e.carrier = port.carrier));
    model = connect(model, port.node, 'bank').model;
    model = updateEdge(model, model.edges.at(-1)!.id, (e) => (e.carrier = port.carrier));
    model = connect(model, 'bank', notPort).model;
    const codes = blockIssues(model)
      .map((i) => i.code)
      .sort();
    expect(codes).toEqual(['block-port', 'block-port-direction']);
  });

  it('drops references to symbols outside, and says so', () => {
    const m = cloneModel(exampleById('grassland')!.model);
    const ids = m.nodes.slice(1).map((n) => n.id);
    const { model, id } = groupNodes(m, ids, 'Pasture');
    const e = model.edges.find((x) => ids.includes(x.origin) && ids.includes(x.target))!;
    const withControl = updateEdge(model, e.id, (x) => {
      x.logic = 'interaction';
      x.params.control_node = m.nodes[0]!.id;
    });
    const { block, notes } = blockFromGroup(withControl, id!, { ...meta, title: 'Pasture' });
    expect(block.model.edges.find((x) => x.id === e.id)?.params.control_node).toBeUndefined();
    expect(notes.some((n) => /control/.test(n))).toBe(true);
  });
});
