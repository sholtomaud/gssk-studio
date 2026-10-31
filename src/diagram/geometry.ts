/**
 * Diagram geometry (SPEC §6.2): where a flow leaves and enters a symbol, its
 * Bézier path, and its midpoint, where a work gate sits. Pure functions over
 * model coordinates, unit-tested without a DOM.
 */
import { symbolFor } from '../model/catalogue.ts';
import type { ModelEdge, NodeType, Point } from '../model/types.ts';

/** Symbols are drawn SIZE canvas units across (their 100-unit viewBox scaled). */
export const SIZE = 80;
export const SCALE = SIZE / 100;

type Outline = 'ellipse' | 'rect' | 'diamond' | 'port-top';

/** A packed zoom group draws as a box of this half-size (FR-GRP-001). */
export const GROUP_HALF = { w: 48, h: 32 };

/** Something a flow can end on: a symbol, or a packed group (`type: 'group'`). */
export interface Shape {
  type: NodeType | 'group';
  /** Where it is, and for a symbol its size (1 = as drawn) and rotation in degrees (FR-EDIT-013). */
  visual: Point & { scale?: number; rotation?: number };
}

/** The sizes a symbol may be drawn at, as a fraction of its own (FR-EDIT-013). */
export const SYMBOL_SCALE = { min: 0.5, max: 3, step: 0.05 };

/** A symbol's size: 1 as drawn; a packed group is always drawn as is. */
export function scaleOf(s: Shape): number {
  return s.type === 'group' ? 1 : (s.visual.scale ?? 1);
}

/** A symbol's rotation in radians, clockwise on screen. */
function turnOf(s: Shape): number {
  return s.type === 'group' ? 0 : ((s.visual.rotation ?? 0) * Math.PI) / 180;
}

/** Half-extents of a shape's outline at its size, before it is turned. */
export function extentOf(s: Shape): { w: number; h: number } {
  const { w, h } = halfExtent(s.type);
  const k = scaleOf(s);
  return { w: w * k, h: h * k };
}

/** Half-extents of the upright box around a shape, sized and turned: where its labels go. */
export function boxOf(s: Shape): { w: number; h: number } {
  const { w, h } = extentOf(s);
  const a = turnOf(s);
  const c = Math.abs(Math.cos(a));
  const n = Math.abs(Math.sin(a));
  return { w: w * c + h * n, h: w * n + h * c };
}

/** `p` turned by `a` radians about the origin. */
export function rotate(p: Point, a: number): Point {
  const c = Math.cos(a);
  const n = Math.sin(a);
  return { x: p.x * c - p.y * n, y: p.x * n + p.y * c };
}

const OUTLINE: Record<NodeType | 'group', Outline> = {
  group: 'rect',
  source: 'ellipse',
  storage: 'rect',
  sink: 'port-top',
  constant: 'rect',
  producer: 'ellipse',
  consumer: 'ellipse',
  interaction: 'rect',
  exchange: 'diamond',
  switch: 'rect',
  gain: 'ellipse',
  loop_limited: 'ellipse',
  misc_box: 'rect',
};

/** Half-extents of a node's outline in canvas units. */
export function halfExtent(type: NodeType | 'group'): { w: number; h: number } {
  if (type === 'group') return GROUP_HALF;
  const h = symbolFor(type).half;
  return { w: h.w * SCALE, h: h.h * SCALE };
}

/**
 * The point on a node's outline in the direction of `toward`, on the outline
 * as sized and turned: a turned heat sink is still entered at its top.
 */
export function anchor(node: Shape, toward: Point): Point {
  const { x: cx, y: cy } = node.visual;
  const turn = turnOf(node);
  const local = localAnchor(node, toward, turn);
  const at = rotate(local, turn);
  return { x: cx + at.x, y: cy + at.y };
}

/** The outline point toward `toward`, in the shape's own unturned frame about its centre. */
function localAnchor(node: Shape, toward: Point, turn: number): Point {
  const { w, h } = extentOf(node);
  const { x: dx, y: dy } = rotate(
    { x: toward.x - node.visual.x, y: toward.y - node.visual.y },
    -turn
  );
  if (dx === 0 && dy === 0) return { x: 0, y: 0 };
  const outline = OUTLINE[node.type];
  if (outline === 'port-top') return { x: 0, y: -h };
  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let r: number;
  if (outline === 'ellipse') {
    r = (w * h) / Math.sqrt((h * cos) ** 2 + (w * sin) ** 2);
  } else if (outline === 'diamond') {
    r = 1 / (Math.abs(cos) / w + Math.abs(sin) / h);
  } else {
    r = Math.min(
      Math.abs(cos) > 1e-9 ? w / Math.abs(cos) : Infinity,
      Math.abs(sin) > 1e-9 ? h / Math.abs(sin) : Infinity
    );
  }
  return { x: r * cos, y: r * sin };
}

/** How far apart parallel flows between the same two symbols run, at their middles. */
export const LANE_GAP = 24;

export interface Curve {
  p0: Point;
  c1: Point;
  c2: Point;
  p1: Point;
}

/**
 * The cubic Bézier for a flow. Without stored control points the curve bows
 * slightly, so a pair of opposite flows between two nodes never overlap;
 * parallel flows between the same two nodes (`lane` 1, 2, …) bow further.
 */
export function edgeCurve(
  edge: Pick<ModelEdge, 'origin' | 'target' | 'visual'>,
  origin: Shape,
  target: Shape,
  lane = 0
): Curve {
  const a = { x: origin.visual.x, y: origin.visual.y };
  const b = { x: target.visual.x, y: target.visual.y };
  if (edge.origin === edge.target) {
    // Self-loop: a lobe above the node.
    const { h } = extentOf(origin);
    const p0 = { x: a.x - 12, y: a.y - h };
    const p1 = { x: a.x + 12, y: a.y - h };
    return { p0, c1: { x: a.x - 60, y: a.y - h - 70 }, c2: { x: a.x + 60, y: a.y - h - 70 }, p1 };
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const bow = 0.2;
  // Each further lane moves both guides out to the bow's side, LANE_GAP apart at the middle.
  const out = (lane * LANE_GAP * 4) / 3;
  const nx = Math.sin(angle) * out;
  const ny = -Math.cos(angle) * out;
  const guide1 = edge.visual?.ctrl1
    ? { x: a.x + edge.visual.ctrl1.x, y: a.y + edge.visual.ctrl1.y }
    : {
        x: a.x + (Math.cos(angle - bow) * dist) / 3 + nx,
        y: a.y + (Math.sin(angle - bow) * dist) / 3 + ny,
      };
  const guide2 = edge.visual?.ctrl2
    ? { x: b.x + edge.visual.ctrl2.x, y: b.y + edge.visual.ctrl2.y }
    : {
        x: b.x - (Math.cos(angle + bow) * dist) / 3 + nx,
        y: b.y - (Math.sin(angle + bow) * dist) / 3 + ny,
      };
  const p0 = anchor(origin, guide1);
  const p1 = anchor(target, guide2);
  const c1 = edge.visual?.ctrl1
    ? { x: p0.x + edge.visual.ctrl1.x, y: p0.y + edge.visual.ctrl1.y }
    : guide1;
  const c2 = edge.visual?.ctrl2
    ? { x: p1.x + edge.visual.ctrl2.x, y: p1.y + edge.visual.ctrl2.y }
    : guide2;
  return { p0, c1, c2, p1 };
}

/**
 * Where a transaction's counter-flow passes its marked flow (FR-TRX-001):
 * beside the marked flow's point at `t`, `COUPLE_GAP` to the side where the
 * counter-flow's own ends lie, so the pair never cross to reach it.
 */
export const COUPLE_GAP = 12;

export function couplePoint(base: Curve, t: number, origin: Shape, target: Shape): Point {
  const at = pointAt(base, t);
  const tan = unit(tangentAt(base, t), base);
  const normal = { x: -tan.y, y: tan.x };
  const mid = {
    x: (origin.visual.x + target.visual.x) / 2,
    y: (origin.visual.y + target.visual.y) / 2,
  };
  const side = (mid.x - at.x) * normal.x + (mid.y - at.y) * normal.y < 0 ? -1 : 1;
  return { x: at.x + normal.x * COUPLE_GAP * side, y: at.y + normal.y * COUPLE_GAP * side };
}

/**
 * A transaction's counter-flow drawn as Odum draws it: alongside its marked
 * flow, the opposite way, passing it at the transaction diamond. A single
 * cubic through the pass point at t = ½ with the reversed tangent there.
 */
export function coupledCurve(base: Curve, t: number, origin: Shape, target: Shape): Curve {
  const m = couplePoint(base, t, origin, target);
  const tan = unit(tangentAt(base, t), base);
  const p0 = anchor(origin, m);
  const p1 = anchor(target, m);
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  // B(½) = (p0 + 3c1 + 3c2 + p1) / 8 = m, and B'(½) = ¾ (p1 − p0 + c2 − c1) ∥ −tan.
  const sum = { x: (8 * m.x - p0.x - p1.x) / 3, y: (8 * m.y - p0.y - p1.y) / 3 };
  const diff = { x: -tan.x * len - (p1.x - p0.x), y: -tan.y * len - (p1.y - p0.y) };
  return {
    p0,
    c1: { x: (sum.x - diff.x) / 2, y: (sum.y - diff.y) / 2 },
    c2: { x: (sum.x + diff.x) / 2, y: (sum.y + diff.y) / 2 },
    p1,
  };
}

export function tangentAt(c: Curve, t: number): Point {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const d = 3 * t * t;
  return {
    x: a * (c.c1.x - c.p0.x) + b * (c.c2.x - c.c1.x) + d * (c.p1.x - c.c2.x),
    y: a * (c.c1.y - c.p0.y) + b * (c.c2.y - c.c1.y) + d * (c.p1.y - c.c2.y),
  };
}

/** A unit vector along `v`, or along the curve's chord when `v` vanishes. */
function unit(v: Point, c: Curve): Point {
  let l = Math.hypot(v.x, v.y);
  if (l < 1e-9) {
    v = { x: c.p1.x - c.p0.x, y: c.p1.y - c.p0.y };
    l = Math.hypot(v.x, v.y);
  }
  return l < 1e-9 ? { x: 1, y: 0 } : { x: v.x / l, y: v.y / l };
}

export function pointAt(c: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p1.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p1.y,
  };
}

export function pathData(c: Curve): string {
  const f = (p: Point) => `${round(p.x)},${round(p.y)}`;
  return `M${f(c.p0)} C${f(c.c1)} ${f(c.c2)} ${f(c.p1)}`;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Bounding box of a set of points, padded; for "zoom to fit". */
export function bounds(
  points: readonly Point[],
  pad = 0
): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) return { x: 0, y: 0, w: 1000, h: 700 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}
