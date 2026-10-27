/**
 * A first layout for nodes a script did not place (FR-SDK-005): Odum's
 * convention of sources on the left, flow running left to right, heat sinks
 * along the bottom. Columns are breadth-first distance from the nodes that
 * nothing flows into; a node never lands on top of one already placed.
 */
import type { ModelEdge, ModelNode } from '../../model/types.ts';

const X0 = 120;
const Y0 = 160;
const COL = 220;
const ROW = 170;
/** Two nodes closer than this, on both axes, overlap. */
const CLEAR = { x: 150, y: 120 };

export function layoutUnplaced(
  nodes: ModelNode[],
  edges: readonly ModelEdge[],
  unplaced: ReadonlySet<string>
): void {
  if (!unplaced.size) return;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!byId.has(e.origin) || !byId.has(e.target)) continue;
    out.set(e.origin, [...(out.get(e.origin) ?? []), e.target]);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const depth = new Map<string, number>();
  const roots = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const queue = roots.length ? roots : nodes.slice(0, 1).map((n) => n.id);
  for (const r of queue) depth.set(r, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const t of out.get(id) ?? []) {
      if (depth.has(t)) continue;
      depth.set(t, depth.get(id)! + 1);
      queue.push(t);
    }
  }

  const occupied: { x: number; y: number }[] = nodes
    .filter((n) => !unplaced.has(n.id))
    .map((n) => ({ x: n.visual.x, y: n.visual.y }));
  const free = (x: number, y: number) =>
    occupied.every((p) => Math.abs(p.x - x) >= CLEAR.x || Math.abs(p.y - y) >= CLEAR.y);
  const place = (n: ModelNode, x: number, y: number, step: { x: number; y: number }) => {
    while (!free(x, y)) {
      x += step.x;
      y += step.y;
    }
    n.visual.x = x;
    n.visual.y = y;
    occupied.push({ x, y });
  };

  const sinks: ModelNode[] = [];
  for (const n of nodes) {
    if (!unplaced.has(n.id)) continue;
    if (n.type === 'sink') {
      sinks.push(n);
      continue;
    }
    place(n, X0 + (depth.get(n.id) ?? 0) * COL, Y0, { x: 0, y: ROW });
  }

  const bottom = Math.max(Y0, ...occupied.map((p) => p.y)) + ROW + 40;
  for (const n of sinks) {
    const feeders = edges
      .filter((e) => e.target === n.id)
      .map((e) => byId.get(e.origin))
      .filter((f): f is ModelNode => f !== undefined && f.type !== 'sink');
    const x = feeders.length
      ? Math.round(feeders.reduce((s, f) => s + f.visual.x, 0) / feeders.length)
      : X0;
    place(n, x, bottom, { x: CLEAR.x, y: 0 });
  }
}
