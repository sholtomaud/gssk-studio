import { describe, expect, it } from 'vitest';
import { CATALOGUE, PALETTE } from '../../src/model/catalogue.ts';
import { SYMBOL_DEFS } from '../../src/diagram/symbols.ts';

const SHAPE = /<(circle|path|line|polygon|rect|text)\b[^>]*>/g;

describe('Odum symbols (FR-EDIT-009)', () => {
  // Page CSS does not reliably reach the shadow copy a <use> draws, and an
  // unstyled SVG shape fills black: every shape must carry its own paint.
  it('gives every shape explicit fill and stroke attributes', () => {
    const shapes = SYMBOL_DEFS.match(SHAPE) ?? [];
    expect(shapes.length).toBeGreaterThan(15);
    for (const s of shapes) {
      expect(s, s).toMatch(/\bfill="/);
      expect(s, s).toMatch(/\bstroke="/);
    }
  });

  it('defines a symbol for every catalogue type', () => {
    for (const spec of CATALOGUE) expect(SYMBOL_DEFS).toContain(`id="${spec.symbol}"`);
  });

  it('leaves constant out of the palette: a source does the same job', () => {
    expect(PALETTE.map((s) => s.type)).not.toContain('constant');
  });

  it('leaves the exchange node out: it moves nothing in the pinned kernel (K-9)', () => {
    // Odum's transaction is the Transaction tool, a marking on a flow and its counter-flow.
    expect(PALETTE.map((s) => s.type)).not.toContain('exchange');
    expect(PALETTE).toHaveLength(CATALOGUE.length - 2);
  });
});
