import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { fileNameFor, ModelFormatError, parseModel, serialiseModel } from '../../src/model/io.ts';

const fixture = readFileSync(
  new URL('../fixtures/gssk-dia-personal-finance.json', import.meta.url),
  'utf8'
);

describe('model files (FR-IO-001..003, ADR 0006)', () => {
  it('round-trips a studio model exactly', () => {
    for (const ex of EXAMPLES) {
      const { model, notes } = parseModel(serialiseModel(ex.model));
      expect(model, ex.id).toEqual(ex.model);
      expect(notes).toEqual([]);
    }
  });

  it('imports a gssk-dia export, saying what it changed', () => {
    const { model, notes } = parseModel(fixture);
    expect(model.nodes.find((n) => n.id === 'market')?.type).toBe('exchange');
    expect(model._diagram.boundaries).toEqual([
      { id: 'boundary', x: 150, y: 50, w: 620, h: 450, label: 'Household System' },
    ]);
    // gssk-dia put control_node on the edge itself; the kernel reads params.
    expect(model.edges.find((e) => e.id === 'e2')?.params.control_node).toBe('income');
    expect(model.edges[2]?.id).toBe('checking_to_market');
    expect(model.config.method).toBe('euler');
    expect(notes.join('\n')).toMatch(/transaction.*exchange/);
    expect(notes.join('\n')).toMatch(/dataType/);
    expect(notes.join('\n')).toMatch(/had no id/);
  });

  it('places unpositioned nodes on a grid and maps the deprecated incipient method', () => {
    const { model, notes } = parseModel(
      JSON.stringify({
        config: { method: 'incipient' },
        nodes: [
          { id: 'a', type: 'storage', value: 1 },
          { id: 'b', type: 'sink', value: 0 },
        ],
        edges: [{ id: 'f', origin: 'a', target: 'b', logic: 'linear', params: { k: 1 } }],
      })
    );
    expect(model.nodes.map((n) => [n.visual.x, n.visual.y])).toEqual([
      [120, 120],
      [300, 120],
    ]);
    expect(model.config.method).toBe('expm');
    expect(notes.some((n) => n.includes('incipient'))).toBe(true);
  });

  it('rejects what is not a model, with a reason', () => {
    expect(() => parseModel('not json')).toThrow(ModelFormatError);
    expect(() => parseModel('{"edges": []}')).toThrow(/no "nodes"/);
    expect(() => parseModel('{"nodes": [{"id": "x", "type": "teleporter"}]}')).toThrow(
      /teleporter/
    );
    expect(() =>
      parseModel(
        '{"nodes": [{"id": "x", "type": "storage"}], "edges": [{"origin": "x", "target": "x", "logic": "magic"}]}'
      )
    ).toThrow(/unknown logic/);
  });

  it('keeps a sensor on a flow through a round trip', () => {
    const m = structuredClone(EXAMPLES[3]!.model);
    m.edges[0]!.visual = { sensor: true };
    expect(parseModel(serialiseModel(m)).model.edges[0]?.visual).toEqual({ sensor: true });
  });

  it('names files after the model', () => {
    expect(fileNameFor(EXAMPLES[0]!.model)).toBe('Grassland-food-chain.gssk.json');
  });
});
