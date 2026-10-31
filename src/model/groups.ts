/**
 * Zoom groups (FR-GRP-001): pack symbols into one and unpack them again, at
 * any depth, the way a cluster packs components in a node editor. A group is
 * editor-only (`_diagram.groups`): the kernel always runs the whole model, so
 * a run is the same packed or unpacked and the model hash does not change.
 *
 * Packed, a group draws as one symbol at the centre of what it holds, and
 * every flow across its edge between the same two visible ends is drawn as
 * one combined flow whose rate is the sum of its members'.
 */
import { symbolFor } from './catalogue.ts';
import { uniqueId } from './ids.ts';
import { cloneModel, type Group, type ModelEdge, type Point, type StudioModel } from './types.ts';

export function groupsOf(m: StudioModel): Group[] {
  return m._diagram.groups ?? [];
}

export function findGroup(m: StudioModel, id: string): Group | undefined {
  return groupsOf(m).find((g) => g.id === id);
}

/** The group a node sits directly in. */
export function groupOfNode(m: StudioModel, nodeId: string): Group | undefined {
  return groupsOf(m).find((g) => g.nodes.includes(nodeId));
}

/** A group's enclosing groups, innermost first. */
export function ancestors(m: StudioModel, groupId: string): Group[] {
  const out: Group[] = [];
  const seen = new Set<string>();
  let g = findGroup(m, groupId)?.parent;
  while (g && !seen.has(g)) {
    seen.add(g);
    const p = findGroup(m, g);
    if (!p) break;
    out.push(p);
    g = p.parent;
  }
  return out;
}

/** The groups a node is in, innermost first. */
export function chainOfNode(m: StudioModel, nodeId: string): Group[] {
  const g = groupOfNode(m, nodeId);
  return g ? [g, ...ancestors(m, g.id)] : [];
}

export function childGroups(m: StudioModel, groupId: string | undefined): Group[] {
  return groupsOf(m).filter((g) => g.parent === groupId);
}

/** Every node inside a group, at any depth. */
export function nodesIn(m: StudioModel, groupId: string): string[] {
  const g = findGroup(m, groupId);
  if (!g) return [];
  return [...g.nodes, ...childGroups(m, groupId).flatMap((c) => nodesIn(m, c.id))];
}

/**
 * What stands for a node on the canvas: the outermost packed group around
 * it, or the node itself.
 */
export function ownerOf(m: StudioModel, nodeId: string): { kind: 'node' | 'group'; id: string } {
  const chain = chainOfNode(m, nodeId);
  for (let i = chain.length - 1; i >= 0; i--) {
    const g = chain[i];
    if (g?.collapsed) return { kind: 'group', id: g.id };
  }
  return { kind: 'node', id: nodeId };
}

/** A group is on screen (packed or as a frame) when nothing around it is packed. */
export function groupShown(m: StudioModel, groupId: string): boolean {
  return ancestors(m, groupId).every((a) => !a.collapsed);
}

/** Where a packed group's symbol sits: the centre of the box around its nodes. */
export function groupCentre(m: StudioModel, groupId: string): Point {
  const ids = new Set(nodesIn(m, groupId));
  const pts = m.nodes.filter((n) => ids.has(n.id)).map((n) => n.visual);
  if (pts.length === 0) return { x: 0, y: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
  };
}

/** One end of a drawn flow: a symbol, or a packed group. */
export interface End {
  kind: 'node' | 'group';
  id: string;
  /**
   * For a packed group that shows its ports: the symbol inside the flows
   * really reach, drawn small inside the group's box (Odum's inset).
   */
  port?: string;
}

/**
 * A packed group shows, inside its box, each symbol inside that a flow
 * across its edge reaches, so the wiring stays visible packed (FR-GRP-001),
 * as Odum draws a bank inside a city. Past this many it is one box.
 */
export const MAX_PORTS = 3;

/** Flows between the same two visible ends, at least one a packed group, drawn as one. */
export interface Bundle {
  /** `origin>target`, each end as `node:id` or `group:id`. */
  id: string;
  origin: End;
  target: End;
  edges: string[];
}

export interface DiagramView {
  /** Nodes drawn as themselves. */
  nodes: Set<string>;
  /** Packed groups drawn as one symbol. */
  packed: Group[];
  /** Unpacked groups drawn as a frame around their contents. */
  frames: Group[];
  /** Flows drawn as themselves: both ends visible as nodes. */
  edges: ModelEdge[];
  bundles: Bundle[];
  /** Per packed group showing its ports, the symbols inside that flows reach, in model order. */
  ports: Map<string, string[]>;
}

const endKey = (e: End) => `${e.kind}:${e.id}${e.port ? `@${e.port}` : ''}`;

export function bundleId(origin: End, target: End): string {
  return `${endKey(origin)}>${endKey(target)}`;
}

/** What the canvas draws for a model at its current packing. */
export function diagramView(m: StudioModel): DiagramView {
  const groups = groupsOf(m);
  const shown = groups.filter((g) => groupShown(m, g.id));
  const owner = new Map(m.nodes.map((n) => [n.id, ownerOf(m, n.id)]));
  const nodes = new Set(m.nodes.filter((n) => owner.get(n.id)?.kind === 'node').map((n) => n.id));
  const edges: ModelEdge[] = [];
  const bundles = new Map<string, Bundle>();
  // The symbols inside each packed group that flows across its edge reach.
  const reached = new Map<string, Set<string>>();
  for (const e of m.edges) {
    const o = owner.get(e.origin);
    const t = owner.get(e.target);
    if (!o || !t || (o.kind === t.kind && o.id === t.id)) continue;
    for (const [end, node] of [
      [o, e.origin],
      [t, e.target],
    ] as const) {
      if (end.kind !== 'group') continue;
      const set = reached.get(end.id) ?? new Set<string>();
      set.add(node);
      reached.set(end.id, set);
    }
  }
  const ports = new Map<string, string[]>();
  for (const [g, set] of reached) {
    if (set.size <= MAX_PORTS)
      ports.set(
        g,
        m.nodes.filter((n) => set.has(n.id)).map((n) => n.id)
      );
  }
  const withPort = (end: End, node: string): End =>
    end.kind === 'group' && ports.has(end.id) ? { ...end, port: node } : end;
  for (const e of m.edges) {
    const o0 = owner.get(e.origin);
    const t0 = owner.get(e.target);
    if (!o0 || !t0) continue;
    const o = withPort(o0, e.origin);
    const t = withPort(t0, e.target);
    if (o.kind === 'node' && t.kind === 'node') {
      edges.push(e);
      continue;
    }
    // Both ends inside the same packed group: drawn inside it, so hidden here.
    if (o.kind === t.kind && o.id === t.id) continue;
    const id = bundleId(o, t);
    const b = bundles.get(id) ?? { id, origin: o, target: t, edges: [] };
    b.edges.push(e.id);
    bundles.set(id, b);
  }
  return {
    nodes,
    packed: shown.filter((g) => g.collapsed),
    frames: shown.filter((g) => !g.collapsed),
    edges,
    bundles: [...bundles.values()],
    ports,
  };
}

/**
 * A packed group's reading: the total level of the storages inside, when they
 * share one carrier (adding money to water would mean nothing).
 */
export function groupTotal(
  m: StudioModel,
  groupId: string,
  values: ReadonlyMap<string, number>
): number | undefined {
  const ids = new Set(nodesIn(m, groupId));
  const stores = m.nodes.filter(
    (n) => ids.has(n.id) && symbolFor(n.type).holdsState && n.type !== 'sink'
  );
  if (stores.length === 0) return undefined;
  if (new Set(stores.map((n) => n.carrier ?? '')).size > 1) return undefined;
  let sum = 0;
  for (const n of stores) {
    const v = values.get(n.id);
    if (v === undefined || !Number.isFinite(v)) return undefined;
    sum += v;
  }
  return sum;
}

// ---- operations ------------------------------------------------------------

function idsOf(m: StudioModel): Set<string> {
  return new Set([
    ...m.nodes.map((n) => n.id),
    ...m.edges.map((e) => e.id),
    ...m._diagram.boundaries.map((b) => b.id),
    ...groupsOf(m).map((g) => g.id),
  ]);
}

/**
 * Pack nodes into a new group. The group goes inside the deepest group that
 * holds them all; a selected node inside a group below that brings its whole
 * group along, so nesting is kept. Returns the model unchanged and a null id
 * for fewer than one node.
 */
export function groupNodes(
  m: StudioModel,
  nodeIds: readonly string[],
  label = 'Group',
  collapsed = true
): { model: StudioModel; id: string | null } {
  const ids = [...new Set(nodeIds)].filter((id) => m.nodes.some((n) => n.id === id));
  if (ids.length === 0) return { model: m, id: null };
  const chains = ids.map((id) => chainOfNode(m, id).map((g) => g.id));
  // The deepest group on every chain.
  const lca = chains[0]?.find((g) => chains.every((c) => c.includes(g)));
  const next = cloneModel(m);
  next._diagram.groups ??= [];
  const id = uniqueId(label.replace(/\s+/g, '_').toLowerCase() || 'group', idsOf(next));
  const group: Group = { id, label, nodes: [], collapsed, ...(lca ? { parent: lca } : {}) };
  const moveGroups = new Set<string>();
  ids.forEach((nodeId, i) => {
    const chain = chains[i] ?? [];
    const at = lca ? chain.indexOf(lca) : chain.length;
    const child = at > 0 ? chain[at - 1] : undefined;
    if (child) moveGroups.add(child);
    else group.nodes.push(nodeId);
  });
  for (const g of next._diagram.groups) {
    g.nodes = g.nodes.filter((n) => !group.nodes.includes(n));
    if (moveGroups.has(g.id)) g.parent = id;
  }
  next._diagram.groups.push(group);
  return { model: next, id };
}

/** Unpack a group for good: what it held moves up to its parent. */
export function ungroup(m: StudioModel, groupId: string): StudioModel {
  const g = findGroup(m, groupId);
  if (!g) return m;
  const next = cloneModel(m);
  const groups = next._diagram.groups ?? [];
  const parent = groups.find((x) => x.id === g.parent);
  if (parent) parent.nodes.push(...g.nodes);
  for (const c of groups) {
    if (c.parent !== groupId) continue;
    if (g.parent) c.parent = g.parent;
    else delete c.parent;
  }
  next._diagram.groups = groups.filter((x) => x.id !== groupId);
  return next;
}

/** Pack or unpack. Unpacking also unpacks every group around it, so it can be seen. */
export function setCollapsed(m: StudioModel, groupId: string, collapsed: boolean): StudioModel {
  if (!findGroup(m, groupId)) return m;
  const next = cloneModel(m);
  const open = new Set([groupId, ...(collapsed ? [] : ancestors(m, groupId).map((a) => a.id))]);
  for (const g of next._diagram.groups ?? []) {
    if (g.id === groupId) g.collapsed = collapsed;
    else if (open.has(g.id)) g.collapsed = false;
  }
  return next;
}

/** Unpack whatever hides a node, so it can be selected and seen. */
export function revealNode(m: StudioModel, nodeId: string): StudioModel {
  const hidden = chainOfNode(m, nodeId).filter((g) => g.collapsed);
  if (hidden.length === 0) return m;
  const next = cloneModel(m);
  const ids = new Set(hidden.map((g) => g.id));
  for (const g of next._diagram.groups ?? []) if (ids.has(g.id)) g.collapsed = false;
  return next;
}

export function renameGroup(m: StudioModel, groupId: string, label: string): StudioModel {
  const next = cloneModel(m);
  const g = (next._diagram.groups ?? []).find((x) => x.id === groupId);
  if (g) g.label = label;
  return next;
}

/**
 * Keep groups in step with the nodes (call after any edit that removes or
 * renames nodes): drop members that no longer exist, then groups left empty,
 * innermost first, and parents that no longer exist.
 */
export function tidyGroups(m: StudioModel, rename?: { from: string; to: string }): void {
  const groups = m._diagram.groups;
  if (!groups) return;
  const nodes = new Set(m.nodes.map((n) => n.id));
  for (const g of groups) {
    if (rename) g.nodes = g.nodes.map((n) => (n === rename.from ? rename.to : n));
    g.nodes = g.nodes.filter((n) => nodes.has(n));
  }
  for (;;) {
    const ids = new Set(groups.map((g) => g.id));
    for (const g of groups) if (g.parent && !ids.has(g.parent)) delete g.parent;
    // A group inside itself (only a hand-edited file can say so) is lifted out.
    for (const g of groups) {
      const seen = new Set([g.id]);
      let p = groups.find((x) => x.id === g.parent);
      while (p && !seen.has(p.id)) {
        seen.add(p.id);
        p = groups.find((x) => x.id === p?.parent);
      }
      if (p) delete g.parent;
    }
    const empty = groups.find(
      (g) => g.nodes.length === 0 && !groups.some((c) => c.parent === g.id)
    );
    if (!empty) break;
    groups.splice(groups.indexOf(empty), 1);
  }
  if (groups.length === 0) delete m._diagram.groups;
}
