import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { canonicalJson, memberId, toKernelModel } from '../../src/model/kernel-json.ts';
import { cloneModel } from '../../src/model/types.ts';

describe('kernel JSON (SPEC §7.1)', () => {
  it('drops everything the kernel does not read', () => {
    const k = toKernelModel(EXAMPLES[0]!.model);
    expect(Object.keys(k).sort()).toEqual(['config', 'edges', 'metadata', 'nodes']);
    expect(JSON.stringify(k)).not.toMatch(/visual|_diagram|label/);
  });

  it('names a composite control by its state member (kernel request K-1)', () => {
    const k = toKernelModel(EXAMPLES[0]!.model);
    const grazing = k.edges.find((e) => e.id === 'grazing') as { params: { control_node: string } };
    expect(grazing.params.control_node).toBe('grazers__body');
    // Edge ends are left alone: the kernel resolves those to the composite's ports.
    expect(grazing).toMatchObject({ origin: 'grass', target: 'grazers' });
    expect(memberId('a'.repeat(40), 'body')).toBe(`${'a'.repeat(29)}__body`);
  });

  it('is independent of layout, so moving a symbol keeps the model hash', () => {
    const m = EXAMPLES[1]!.model;
    const moved = cloneModel(m);
    moved.nodes[0]!.visual.x += 300;
    moved._diagram.boundaries.push({ id: 'b', x: 0, y: 0, w: 1, h: 1, label: '' });
    expect(canonicalJson(toKernelModel(moved))).toBe(canonicalJson(toKernelModel(m)));
  });

  it('sorts keys canonically', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}'
    );
  });
});
