/**
 * Editing operations on a model (SPEC §6). Each takes a model and returns a
 * new one, never mutating its input, so the editor can keep history as a
 * list of snapshots and every operation is unit-testable without a DOM.
 */
import { symbolFor } from './catalogue.ts';
import { uniqueId } from './ids.ts';
import {
  cloneModel,
  type Boundary,
  type EdgeLogic,
  type ModelEdge,
  type ModelNode,
  type NodeType,
  type Point,
  type StudioModel,
} from './types.ts';

/** What the editor has selected. */
export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'boundary'; id: string }
  | null;

function allIds(m: StudioModel): Set<string> {
  return new Set([
    ...m.nodes.map((n) => n.id),
    ...m.edges.map((e) => e.id),
    ...m._diagram.boundaries.map((b) => b.id),
  ]);
}

export function findNode(m: StudioModel, id: string): ModelNode | undefined {
  return m.nodes.find((n) => n.id === id);
}

export function findEdge(m: StudioModel, id: string): ModelEdge | undefined {
  return m.edges.find((e) => e.id === id);
}

export function snap(v: number, grid: number): number {
  return grid > 0 ? Math.round(v / grid) * grid : v;
}

const DEFAULT_VALUE: Partial<Record<NodeType, number>> = {
  source: 100,
  storage: 10,
  producer: 10,
  consumer: 5,
  constant: 1,
};

export function addNode(
  m: StudioModel,
  type: NodeType,
  at: Point,
  label = symbolFor(type).label
): { model: StudioModel; id: string } {
  const next = cloneModel(m);
  const id = uniqueId(label, allIds(next));
  const node: ModelNode = {
    id,
    type,
    value: DEFAULT_VALUE[type] ?? 0,
    visual: { x: at.x, y: at.y, label },
  };
  if (symbolFor(type).holdsState && type !== 'sink') node.visual.capacity = 100;
  next.nodes.push(node);
  return { model: next, id };
}

export function moveNode(m: StudioModel, id: string, to: Point): StudioModel {
  const next = cloneModel(m);
  const n = findNode(next, id);
  if (n) {
    n.visual.x = to.x;
    n.visual.y = to.y;
  }
  return next;
}

/** Default logic for a new flow: interaction for a work gate, linear otherwise. */
function defaultLogic(m: StudioModel, origin: string): EdgeLogic {
  const o = findNode(m, origin);
  return o?.type === 'constant' ? 'constant' : 'linear';
}

/**
 * A flow from origin to target. Refuses self-loops and duplicates of an
 * existing origin→target flow, returning the model unchanged and id null.
 */
export function connect(
  m: StudioModel,
  origin: string,
  target: string
): { model: StudioModel; id: string | null } {
  if (origin === target || !findNode(m, origin) || !findNode(m, target)) {
    return { model: m, id: null };
  }
  if (m.edges.some((e) => e.origin === origin && e.target === target)) {
    return { model: m, id: null };
  }
  const next = cloneModel(m);
  const id = uniqueId(`${origin}_to_${target}`, allIds(next));
  next.edges.push({ id, origin, target, logic: defaultLogic(m, origin), params: { k: 0.1 } });
  return { model: next, id };
}

/**
 * Wire a control into a flow (Odum's work gate, SPEC §6.3): the edge becomes
 * an interaction controlled by `controlId`, unless its logic already reads a
 * control node, in which case only the control changes.
 */
export function setControl(m: StudioModel, edgeId: string, controlId: string): StudioModel {
  if (!findNode(m, controlId)) return m;
  const next = cloneModel(m);
  const e = findEdge(next, edgeId);
  if (!e) return m;
  e.params.control_node = controlId;
  if (!['interaction', 'limit', 'ratio', 'subtract'].includes(e.logic)) e.logic = 'interaction';
  return next;
}

/** Remove a node, every flow touching it, and every control reference to it. */
export function removeNode(m: StudioModel, id: string): StudioModel {
  const next = cloneModel(m);
  next.nodes = next.nodes.filter((n) => n.id !== id);
  next.edges = next.edges.filter((e) => e.origin !== id && e.target !== id);
  for (const e of next.edges) {
    if (e.params.control_node === id) {
      delete e.params.control_node;
      if (e.logic === 'interaction' || e.logic === 'ratio' || e.logic === 'subtract') {
        e.logic = 'linear';
      }
    }
    if (e.params.numerator_node === id) delete e.params.numerator_node;
  }
  for (const n of next.nodes) if (n.params?.price_node === id) delete n.params.price_node;
  return next;
}

export function removeEdge(m: StudioModel, id: string): StudioModel {
  const next = cloneModel(m);
  next.edges = next.edges.filter((e) => e.id !== id);
  return next;
}

export function removeSelection(m: StudioModel, sel: Selection): StudioModel {
  if (!sel) return m;
  if (sel.kind === 'node') return removeNode(m, sel.id);
  if (sel.kind === 'edge') return removeEdge(m, sel.id);
  const next = cloneModel(m);
  next._diagram.boundaries = next._diagram.boundaries.filter((b) => b.id !== sel.id);
  return next;
}

/** Change a node's id everywhere it is referenced. Refuses a clash. */
export function renameNode(m: StudioModel, from: string, to: string): StudioModel {
  if (from === to || !findNode(m, from) || allIds(m).has(to)) return m;
  const next = cloneModel(m);
  for (const n of next.nodes) {
    if (n.id === from) n.id = to;
    if (n.params?.price_node === from) n.params.price_node = to;
  }
  for (const e of next.edges) {
    if (e.origin === from) e.origin = to;
    if (e.target === from) e.target = to;
    if (e.params.control_node === from) e.params.control_node = to;
    if (e.params.numerator_node === from) e.params.numerator_node = to;
  }
  return next;
}

export function updateNode(m: StudioModel, id: string, patch: (n: ModelNode) => void): StudioModel {
  const next = cloneModel(m);
  const n = findNode(next, id);
  if (n) patch(n);
  return next;
}

export function updateEdge(m: StudioModel, id: string, patch: (e: ModelEdge) => void): StudioModel {
  const next = cloneModel(m);
  const e = findEdge(next, id);
  if (e) patch(e);
  return next;
}

export function addBoundary(
  m: StudioModel,
  rect: Omit<Boundary, 'id' | 'label'>,
  label = 'System boundary'
): { model: StudioModel; id: string } {
  const next = cloneModel(m);
  const id = uniqueId('boundary', allIds(next));
  next._diagram.boundaries.push({ id, label, ...rect });
  return { model: next, id };
}

export function updateBoundary(
  m: StudioModel,
  id: string,
  patch: (b: Boundary) => void
): StudioModel {
  const next = cloneModel(m);
  const b = next._diagram.boundaries.find((x) => x.id === id);
  if (b) patch(b);
  return next;
}
