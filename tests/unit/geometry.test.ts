import { describe, expect, it } from 'vitest';
import {
  anchor,
  bounds,
  COUPLE_GAP,
  couplePoint,
  coupledCurve,
  edgeCurve,
  halfExtent,
  pathData,
  pointAt,
  tangentAt,
} from '../../src/diagram/geometry.ts';
import type { ModelEdge, ModelNode } from '../../src/model/types.ts';

const node = (id: string, type: ModelNode['type'], x: number, y: number): ModelNode => ({
  id,
  type,
  value: 0,
  visual: { x, y },
});
const edge: ModelEdge = { id: 'f', origin: 'a', target: 'b', logic: 'linear', params: { k: 1 } };

describe('diagram geometry (SPEC §6.2)', () => {
  it('anchors on a circle’s outline in the direction asked', () => {
    const a = node('a', 'source', 0, 0);
    const r = halfExtent('source').w;
    const p = anchor(a, { x: 100, y: 0 });
    expect(p.x).toBeCloseTo(r);
    expect(p.y).toBeCloseTo(0);
  });

  it('anchors on a rectangle’s edge, not past it', () => {
    const a = node('a', 'storage', 0, 0);
    const { w, h } = halfExtent('storage');
    expect(anchor(a, { x: 1000, y: 0 }).x).toBeCloseTo(w);
    expect(anchor(a, { x: 0, y: -1000 }).y).toBeCloseTo(-h);
  });

  it('always enters a heat sink from the top', () => {
    const s = node('b', 'sink', 50, 50);
    expect(anchor(s, { x: 0, y: 1000 })).toEqual({ x: 50, y: 50 - halfExtent('sink').h });
  });

  it('draws a flow from outline to outline, bowed', () => {
    const c = edgeCurve(edge, node('a', 'source', 0, 0), node('b', 'source', 300, 0));
    expect(c.p0.x).toBeGreaterThan(0);
    expect(c.p1.x).toBeLessThan(300);
    const mid = pointAt(c, 0.5);
    expect(mid.x).toBeCloseTo(150, 0);
    expect(mid.y).not.toBeCloseTo(0, 0);
    expect(pathData(c)).toMatch(/^M[\d.,-]+ C/);
  });

  it('uses stored control points as offsets from the anchors', () => {
    const e = { ...edge, visual: { ctrl1: { x: 0, y: -100 }, ctrl2: { x: 0, y: -100 } } };
    const c = edgeCurve(e, node('a', 'storage', 0, 0), node('b', 'storage', 300, 0));
    expect(c.c1.y).toBeCloseTo(c.p0.y - 100);
    expect(c.c2.y).toBeCloseTo(c.p1.y - 100);
  });

  it('bounds points with padding, and a default view when empty', () => {
    expect(
      bounds(
        [
          { x: 0, y: 0 },
          { x: 10, y: 20 },
        ],
        5
      )
    ).toEqual({ x: -5, y: -5, w: 20, h: 30 });
    expect(bounds([]).w).toBeGreaterThan(0);
  });

  describe('a transaction’s counter-flow (FR-TRX-001)', () => {
    // Goods left to right along y = 0; money from below the buyer back to below the seller.
    const goods = edgeCurve(edge, node('a', 'storage', 0, 0), node('b', 'storage', 400, 0));
    const payer = node('p', 'storage', 400, 160);
    const payee = node('q', 'storage', 0, 160);

    it('passes the marked flow’s diamond a small gap away, on the side of its own ends', () => {
      const at = pointAt(goods, 0.5);
      const pass = couplePoint(goods, 0.5, payer, payee);
      expect(Math.hypot(pass.x - at.x, pass.y - at.y)).toBeCloseTo(COUPLE_GAP);
      expect(pass.y).toBeGreaterThan(at.y);
      const c = coupledCurve(goods, 0.5, payer, payee);
      const mid = pointAt(c, 0.5);
      expect(mid.x).toBeCloseTo(pass.x);
      expect(mid.y).toBeCloseTo(pass.y);
    });

    it('runs the opposite way to the marked flow where they meet', () => {
      const c = coupledCurve(goods, 0.5, payer, payee);
      const a = tangentAt(goods, 0.5);
      const b = tangentAt(c, 0.5);
      const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
      expect(cos).toBeCloseTo(-1);
    });

    it('starts and ends on its own symbols’ outlines', () => {
      const c = coupledCurve(goods, 0.5, payer, payee);
      expect(Math.hypot(c.p0.x - 400, c.p0.y - 160)).toBeLessThan(60);
      expect(Math.hypot(c.p1.x, c.p1.y - 160)).toBeLessThan(60);
    });
  });
});
