/**
 * Editing operations on a model (SPEC §6). Each takes a model and returns a
 * new one, never mutating its input, so the editor can keep history as a
 * list of snapshots and every operation is unit-testable without a DOM.
 */
import { symbolFor } from './catalogue.ts';
import { diagramView, findGroup, nodesIn, tidyGroups } from './groups.ts';
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
  /** Two or more nodes (FR-EDIT-011). */
  | { kind: 'nodes'; ids: string[] }
  | { kind: 'edge'; id: string }
  | { kind: 'boundary'; id: string }
  /** A zoom group, packed or as a frame (FR-GRP-001). */
  | { kind: 'group'; id: string }
  /** A combined flow across a packed group's edge. */
  | { kind: 'bundle'; id: string }
  | null;

function allIds(m: StudioModel): Set<string> {
  return new Set([
    ...m.nodes.map((n) => n.id),
    ...m.edges.map((e) => e.id),
    ...m._diagram.boundaries.map((b) => b.id),
    ...(m._diagram.groups ?? []).map((g) => g.id),
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

/** Point observations measuring `from` at `to`, or unmap them (null). */
function retarget(m: StudioModel, from: string, to: string | null): void {
  for (const o of m._observations ?? []) if (o.target === from) o.target = to;
}

/** Remove a node, every flow touching it, and every control reference to it. */
export function removeNode(m: StudioModel, id: string): StudioModel {
  const next = cloneModel(m);
  retarget(next, id, null);
  for (const e of m.edges)
    if (e.origin === id || e.target === id) retarget(next, `flow:${e.id}`, null);
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
  tidyGroups(next);
  return next;
}

export function removeEdge(m: StudioModel, id: string): StudioModel {
  const next = cloneModel(m);
  retarget(next, `flow:${id}`, null);
  next.edges = next.edges.filter((e) => e.id !== id);
  return next;
}

export function removeSelection(m: StudioModel, sel: Selection): StudioModel {
  if (!sel) return m;
  if (sel.kind === 'node') return removeNode(m, sel.id);
  if (sel.kind === 'nodes') return sel.ids.reduce(removeNode, m);
  if (sel.kind === 'edge') return removeEdge(m, sel.id);
  // Deleting a group deletes what it holds; to keep the contents, ungroup instead.
  if (sel.kind === 'group') return nodesIn(m, sel.id).reduce(removeNode, m);
  if (sel.kind === 'bundle') return m;
  const next = cloneModel(m);
  next._diagram.boundaries = next._diagram.boundaries.filter((b) => b.id !== sel.id);
  return next;
}

/** Change a node's id everywhere it is referenced. Refuses a clash. */
export function renameNode(m: StudioModel, from: string, to: string): StudioModel {
  if (from === to || !findNode(m, from) || allIds(m).has(to)) return m;
  const next = cloneModel(m);
  retarget(next, from, to);
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
  tidyGroups(next, { from, to });
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

/** Put a sensor on a flow, or take it off (FR-EDIT-010). */
export function toggleSensor(m: StudioModel, edgeId: string): StudioModel {
  const e0 = findEdge(m, edgeId);
  if (!e0) return m;
  const next = cloneModel(m);
  const e = findEdge(next, edgeId);
  if (!e) return m;
  const { sensor, ...rest } = e.visual ?? {};
  if (sensor) {
    // Observations of this flow's J lose their target with the sensor.
    retarget(next, `flow:${edgeId}`, null);
    if (Object.keys(rest).length) e.visual = rest;
    else delete e.visual;
  } else {
    e.visual = { ...rest, sensor: true };
  }
  return next;
}

// ---- several nodes at once (FR-EDIT-011) -----------------------------------

/** A stable string for a selection, to tell whether it changed. */
export function selectionKey(sel: Selection): string {
  if (!sel) return 'model';
  if (sel.kind === 'nodes') return `nodes:${[...sel.ids].sort().join(',')}`;
  return `${sel.kind}:${sel.id}`;
}

/** The selection with anything the model no longer has dropped. */
export function pruneSelection(m: StudioModel, sel: Selection): Selection {
  if (!sel) return null;
  if (sel.kind === 'node' || sel.kind === 'nodes') {
    return selectNodes(selectedNodeIds(sel).filter((id) => m.nodes.some((n) => n.id === id)));
  }
  if (sel.kind === 'edge') return m.edges.some((e) => e.id === sel.id) ? sel : null;
  if (sel.kind === 'group') return findGroup(m, sel.id) ? sel : null;
  if (sel.kind === 'bundle')
    return diagramView(m).bundles.some((b) => b.id === sel.id) ? sel : null;
  return m._diagram.boundaries.some((b) => b.id === sel.id) ? sel : null;
}

/** The node ids a selection covers. */
export function selectedNodeIds(sel: Selection): string[] {
  if (sel?.kind === 'node') return [sel.id];
  if (sel?.kind === 'nodes') return [...sel.ids];
  return [];
}

/** The selection for a set of node ids: none, one node, or several. */
export function selectNodes(ids: readonly string[]): Selection {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return null;
  if (unique.length === 1) return { kind: 'node', id: unique[0] ?? '' };
  return { kind: 'nodes', ids: unique };
}

export function moveNodes(
  m: StudioModel,
  ids: readonly string[],
  dx: number,
  dy: number
): StudioModel {
  const set = new Set(ids);
  const next = cloneModel(m);
  for (const n of next.nodes) {
    if (set.has(n.id)) {
      n.visual.x += dx;
      n.visual.y += dy;
    }
  }
  return next;
}

/** Nodes, and the flows between them, as a self-contained piece of model. */
export interface Fragment {
  nodes: ModelNode[];
  edges: ModelEdge[];
}

export function copyFragment(m: StudioModel, ids: readonly string[]): Fragment {
  const set = new Set(ids);
  return structuredClone({
    nodes: m.nodes.filter((n) => set.has(n.id)),
    edges: m.edges.filter((e) => set.has(e.origin) && set.has(e.target)),
  });
}

/**
 * Add a copy of a fragment, offset by `by`, with fresh ids. References inside
 * the fragment follow the copies; a control or price node outside it keeps
 * pointing at the original if the model still has it, and is dropped if not.
 */
export function pasteFragment(
  m: StudioModel,
  frag: Fragment,
  by: Point
): { model: StudioModel; ids: string[] } {
  const next = cloneModel(m);
  const taken = allIds(next);
  const rename = new Map<string, string>();
  for (const n of frag.nodes) {
    const id = uniqueId(n.id, taken);
    taken.add(id);
    rename.set(n.id, id);
  }
  const ref = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    const copied = rename.get(id);
    if (copied) return copied;
    return next.nodes.some((n) => n.id === id) ? id : undefined;
  };
  for (const src of frag.nodes) {
    const n = structuredClone(src);
    n.id = rename.get(src.id) ?? n.id;
    n.visual.x += by.x;
    n.visual.y += by.y;
    if (n.params?.price_node !== undefined) {
      const p = ref(n.params.price_node);
      if (p) n.params.price_node = p;
      else delete n.params.price_node;
    }
    next.nodes.push(n);
  }
  for (const src of frag.edges) {
    const e = structuredClone(src);
    e.origin = rename.get(src.origin) ?? e.origin;
    e.target = rename.get(src.target) ?? e.target;
    e.id = uniqueId(`${e.origin}_to_${e.target}`, taken);
    taken.add(e.id);
    for (const key of ['control_node', 'numerator_node'] as const) {
      if (e.params[key] === undefined) continue;
      const r = ref(e.params[key]);
      if (r) e.params[key] = r;
      else delete e.params[key];
    }
    next.edges.push(e);
  }
  return { model: next, ids: frag.nodes.map((n) => rename.get(n.id) ?? n.id) };
}

export type Alignment = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

/** Line node centres up on one axis (FR-EDIT-012). */
export function alignNodes(m: StudioModel, ids: readonly string[], how: Alignment): StudioModel {
  const set = new Set(ids);
  const nodes = m.nodes.filter((n) => set.has(n.id));
  if (nodes.length < 2) return m;
  const xs = nodes.map((n) => n.visual.x);
  const ys = nodes.map((n) => n.visual.y);
  const mid = (v: number[]) => (Math.min(...v) + Math.max(...v)) / 2;
  const target: Record<Alignment, number> = {
    left: Math.min(...xs),
    centre: mid(xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    middle: mid(ys),
    bottom: Math.max(...ys),
  };
  const horizontal = how === 'left' || how === 'centre' || how === 'right';
  const next = cloneModel(m);
  for (const n of next.nodes) {
    if (!set.has(n.id)) continue;
    if (horizontal) n.visual.x = target[how];
    else n.visual.y = target[how];
  }
  return next;
}

/** Space node centres evenly between the outermost two (FR-EDIT-012). */
export function distributeNodes(
  m: StudioModel,
  ids: readonly string[],
  axis: 'x' | 'y'
): StudioModel {
  const set = new Set(ids);
  const next = cloneModel(m);
  const nodes = next.nodes
    .filter((n) => set.has(n.id))
    .sort((a, b) => a.visual[axis] - b.visual[axis]);
  if (nodes.length < 3) return m;
  const first = nodes[0]?.visual[axis] ?? 0;
  const last = nodes[nodes.length - 1]?.visual[axis] ?? 0;
  const gap = (last - first) / (nodes.length - 1);
  nodes.forEach((n, i) => (n.visual[axis] = Math.round(first + gap * i)));
  return next;
}
