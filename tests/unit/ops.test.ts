import { describe, expect, it } from 'vitest';
import {
  addBoundary,
  addNode,
  connect,
  moveNode,
  removeNode,
  removeSelection,
  renameNode,
  setControl,
  snap,
  toggleSensor,
} from '../../src/model/ops.ts';
import { emptyModel, type StudioModel } from '../../src/model/types.ts';

function threeNodes(): StudioModel {
  let m = emptyModel('t');
  m = addNode(m, 'source', { x: 0, y: 0 }, 'Sun').model;
  m = addNode(m, 'storage', { x: 200, y: 0 }, 'Tank').model;
  m = addNode(m, 'sink', { x: 400, y: 0 }, 'Heat').model;
  return m;
}

describe('model operations (SPEC §6)', () => {
  it('adds nodes with unique, kernel-safe ids from their labels', () => {
    let m = emptyModel();
    const a = addNode(m, 'storage', { x: 0, y: 0 }, 'Grass Biomass');
    m = a.model;
    const b = addNode(m, 'storage', { x: 10, y: 0 }, 'Grass Biomass');
    expect(a.id).toBe('grass_biomass');
    expect(b.id).toBe('grass_biomass_2');
    expect(b.model.nodes.map((n) => n.type)).toEqual(['storage', 'storage']);
    expect(b.model.nodes[0]?.visual.capacity).toBe(100);
  });

  it('never mutates its input', () => {
    const m = threeNodes();
    const before = JSON.stringify(m);
    moveNode(m, 'sun', { x: 5, y: 5 });
    connect(m, 'sun', 'tank');
    removeNode(m, 'tank');
    expect(JSON.stringify(m)).toBe(before);
  });

  it('connects two nodes, refusing self-loops; a second flow is a parallel pathway', () => {
    const m = threeNodes();
    const a = connect(m, 'sun', 'tank');
    expect(a.id).toBe('sun_to_tank');
    expect(a.model.edges[0]).toMatchObject({ origin: 'sun', target: 'tank', logic: 'linear' });
    const b = connect(a.model, 'sun', 'tank');
    expect(b.id).toBe('sun_to_tank_2');
    expect(b.model.edges).toHaveLength(2);
    expect(connect(m, 'sun', 'sun').id).toBeNull();
    expect(connect(m, 'sun', 'nowhere').id).toBeNull();
  });

  it('wiring a node onto a flow makes it the flow’s control (work gate)', () => {
    const { model, id } = connect(threeNodes(), 'tank', 'heat');
    const m = setControl(model, id ?? '', 'sun');
    expect(m.edges[0]).toMatchObject({ logic: 'interaction', params: { control_node: 'sun' } });
  });

  it('removing a node removes its flows and its control references', () => {
    let m = threeNodes();
    m = connect(m, 'sun', 'tank').model;
    m = connect(m, 'tank', 'heat').model;
    m = setControl(m, 'tank_to_heat', 'sun');
    const after = removeNode(m, 'sun');
    expect(after.nodes.map((n) => n.id)).toEqual(['tank', 'heat']);
    expect(after.edges).toHaveLength(1);
    expect(after.edges[0]?.params.control_node).toBeUndefined();
    expect(after.edges[0]?.logic).toBe('linear');
  });

  it('renames a node everywhere and refuses a clash', () => {
    let m = threeNodes();
    m = connect(m, 'tank', 'heat').model;
    m = setControl(m, 'tank_to_heat', 'sun');
    const r = renameNode(m, 'sun', 'light');
    expect(r.nodes[0]?.id).toBe('light');
    expect(r.edges[0]?.params.control_node).toBe('light');
    expect(renameNode(m, 'sun', 'tank')).toBe(m);
  });

  it('adds and removes boundaries without touching nodes', () => {
    const { model, id } = addBoundary(threeNodes(), { x: 0, y: 0, w: 100, h: 100 });
    expect(model._diagram.boundaries).toHaveLength(1);
    const after = removeSelection(model, { kind: 'boundary', id });
    expect(after._diagram.boundaries).toHaveLength(0);
    expect(after.nodes).toHaveLength(3);
  });

  it('snaps to the grid', () => {
    expect(snap(14, 10)).toBe(10);
    expect(snap(15, 10)).toBe(20);
    expect(snap(7, 0)).toBe(7);
  });

  it('puts a sensor on a flow and takes it off, keeping its curve (FR-EDIT-010)', () => {
    let m = connect(threeNodes(), 'sun', 'tank').model;
    m.edges[0]!.visual = { ctrl1: { x: 1, y: 2 } };
    const on = toggleSensor(m, 'sun_to_tank');
    expect(on.edges[0]?.visual).toEqual({ ctrl1: { x: 1, y: 2 }, sensor: true });
    const off = toggleSensor(on, 'sun_to_tank');
    expect(off.edges[0]?.visual).toEqual({ ctrl1: { x: 1, y: 2 } });
    m = connect(threeNodes(), 'sun', 'tank').model;
    expect(
      toggleSensor(toggleSensor(m, 'sun_to_tank'), 'sun_to_tank').edges[0]?.visual
    ).toBeUndefined();
    expect(toggleSensor(m, 'nope')).toBe(m);
  });
});
