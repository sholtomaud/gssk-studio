import { describe, expect, it } from 'vitest';
import { exampleById } from '../../src/model/examples/index.ts';
import {
  diagramView,
  groupCentre,
  groupNodes,
  groupTotal,
  MAX_PORTS,
  nodesIn,
  ownerOf,
  revealNode,
  setCollapsed,
  ungroup,
} from '../../src/model/groups.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { canonicalJson, toKernelModel } from '../../src/model/kernel-json.ts';
import { removeNode, removeSelection, renameNode } from '../../src/model/ops.ts';
import { cloneModel } from '../../src/model/types.ts';

const budget = () => cloneModel(exampleById('budget')!.model);
const household = () => cloneModel(exampleById('household')!.model);

describe('zoom groups (FR-GRP-001)', () => {
  it('a packed group draws as one symbol, its flows out as one combined flow', () => {
    const v = diagramView(budget());
    expect(v.packed.map((g) => g.id)).toEqual(['expenses']);
    expect(v.frames).toEqual([]);
    expect([...v.nodes].sort()).toEqual(['bank', 'salary', 'savings']);
    expect(v.edges.map((e) => e.id).sort()).toEqual(['pay', 'save']);
    expect(v.bundles).toHaveLength(1);
    expect(v.bundles[0]!.id).toBe('node:bank>group:expenses');
    expect(v.bundles[0]!.edges).toHaveLength(11);
  });

  it('unpacking shows the groups inside, each packed or framed as saved', () => {
    const v = diagramView(setCollapsed(budget(), 'expenses', false));
    expect(v.frames.map((g) => g.id).sort()).toEqual(['comms', 'expenses', 'housing', 'living']);
    expect(v.packed.map((g) => g.id)).toEqual(['renewals']);
    // Renewals holds two symbols that flows reach, so it shows both, each with its own flow.
    expect(v.ports.get('renewals')).toEqual(['car_insurance', 'computer']);
    const renewals = v.bundles.filter((b) => b.target.id === 'renewals');
    expect(renewals.map((b) => [b.target.port, b.edges])).toEqual([
      ['car_insurance', ['car_insurance_bill']],
      ['computer', ['computer_bill']],
    ]);
    expect(v.edges.map((e) => e.id)).toContain('rent_bill');
  });

  it('a packed group shows the symbols inside that flows reach, up to MAX_PORTS (Odum’s inset)', () => {
    const v = diagramView(cloneModel(exampleById('water')!.model));
    // Water into the tank; wages in and the water bill out of the bank account.
    expect(v.ports.get('home')).toEqual(['tank', 'bank']);
    const into = (port: string) =>
      v.bundles.filter((b) => b.target.port === port || b.origin.port === port).map((b) => b.edges);
    expect(into('tank')).toEqual([['supply']]);
    expect(into('bank').sort()).toEqual([['earn'], ['water_bill']]);
    // Past MAX_PORTS it is one box: Expenses reaches eleven bills.
    expect(diagramView(budget()).ports.has('expenses')).toBe(false);
    expect(MAX_PORTS).toBe(3);
  });

  it('never changes what the kernel runs, so the model hash is the same', () => {
    const packed = budget();
    const open = setCollapsed(setCollapsed(packed, 'expenses', false), 'renewals', false);
    const flat = cloneModel(packed);
    delete flat._diagram.groups;
    const hash = (m: typeof packed) => canonicalJson(toKernelModel(m));
    expect(hash(open)).toBe(hash(packed));
    expect(hash(flat)).toBe(hash(packed));
  });

  it('groups selected symbols, nesting under the deepest group that holds them all', () => {
    const m = setCollapsed(budget(), 'expenses', false);
    const { model, id } = groupNodes(m, ['groceries', 'eating_out'], 'Food');
    expect(id).toBe('food');
    const food = model._diagram.groups!.find((g) => g.id === 'food')!;
    expect(food.parent).toBe('living');
    expect(food.collapsed).toBe(true);
    const living = model._diagram.groups!.find((g) => g.id === 'living')!;
    expect(living.nodes).toEqual(['clothes', 'shoes']);
    expect(nodesIn(model, 'living').sort()).toEqual([
      'clothes',
      'eating_out',
      'groceries',
      'shoes',
    ]);
    expect(m).toEqual(setCollapsed(budget(), 'expenses', false));
  });

  it('a selection across groups carries their whole groups into the new one', () => {
    const { model, id } = groupNodes(budget(), ['rent', 'phone'], 'Fixed');
    const g = (gid: string) => model._diagram.groups!.find((x) => x.id === gid)!;
    expect(g(id!).parent).toBe('expenses');
    expect(g('housing').parent).toBe(id);
    expect(g('comms').parent).toBe(id);
    expect(nodesIn(model, id!).sort()).toEqual([
      'electricity',
      'internet',
      'phone',
      'rent',
      'water',
    ]);
  });

  it('ungrouping keeps the contents, moved up a level', () => {
    const m = ungroup(budget(), 'living');
    expect(m._diagram.groups!.some((g) => g.id === 'living')).toBe(false);
    expect(m._diagram.groups!.find((g) => g.id === 'expenses')!.nodes).toEqual([
      'groceries',
      'eating_out',
      'clothes',
      'shoes',
    ]);
    expect(m.nodes).toHaveLength(budget().nodes.length);
  });

  it('follows renames and deletions, and drops groups left empty', () => {
    let m = renameNode(budget(), 'phone', 'mobile');
    expect(m._diagram.groups!.find((g) => g.id === 'comms')!.nodes).toEqual(['mobile', 'internet']);
    m = removeNode(removeNode(m, 'mobile'), 'internet');
    expect(m._diagram.groups!.some((g) => g.id === 'comms')).toBe(false);
    const gone = removeSelection(budget(), { kind: 'group', id: 'expenses' });
    expect(gone.nodes.map((n) => n.id).sort()).toEqual(['bank', 'salary', 'savings']);
    expect(gone._diagram.groups).toBeUndefined();
  });

  it('reveals a packed symbol by unpacking every group around it', () => {
    const m = revealNode(budget(), 'computer');
    expect(ownerOf(m, 'computer')).toEqual({ kind: 'node', id: 'computer' });
    expect(m._diagram.groups!.find((g) => g.id === 'housing')!.collapsed).toBe(false);
    expect(revealNode(m, 'rent')).toBe(m);
  });

  it('sits at the centre of what it holds and totals like-carrier storages only', () => {
    const m = household();
    const { model, id } = groupNodes(m, ['bank', 'savings'], 'Money');
    expect(groupCentre(model, id!)).toEqual({ x: 370, y: 345 });
    const values = new Map([
      ['bank', 10],
      ['savings', 5],
    ]);
    expect(groupTotal(model, id!, values)).toBe(15);
    model.nodes.find((n) => n.id === 'savings')!.carrier = 'shares';
    expect(groupTotal(model, id!, values)).toBeUndefined();
    // Sinks only accumulate: a group of them has no total.
    expect(groupTotal(budget(), 'renewals', new Map())).toBeUndefined();
  });

  it('round-trips through a file, and drops what a file gets wrong', () => {
    const m = budget();
    expect(parseModel(serialiseModel(m)).model._diagram.groups).toEqual(m._diagram.groups);
    const raw = JSON.parse(serialiseModel(m));
    raw._diagram.groups.push(
      { id: 'twice', label: 'Twice', nodes: ['rent', 'ghost'], collapsed: false },
      { id: 'a', label: 'A', nodes: ['salary'], parent: 'b', collapsed: false },
      { id: 'b', label: 'B', nodes: ['savings'], parent: 'a', collapsed: false }
    );
    const back = parseModel(JSON.stringify(raw)).model;
    // A node in two groups stays in the first; a missing node and an empty group go.
    expect(back._diagram.groups!.some((g) => g.id === 'twice')).toBe(false);
    // A loop of parents is broken rather than followed forever.
    expect(nodesIn(back, 'a').length + nodesIn(back, 'b').length).toBeLessThanOrEqual(3);
    expect(diagramView(back).nodes.size).toBeGreaterThan(0);
  });
});
