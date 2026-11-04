import { describe, expect, it } from 'vitest';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { toKernelModel } from '../../src/model/kernel-json.ts';
import { removeNode, renameNode } from '../../src/model/ops.ts';
import { controlsOf, emptyModel, type StudioModel } from '../../src/model/types.ts';
import { validate } from '../../src/model/validate.ts';

function three(): StudioModel {
  const m = emptyModel();
  for (const id of ['a', 'b', 'c', 'p'])
    m.nodes.push({ id, type: id === 'p' ? 'storage' : 'source', value: 1, visual: { x: 0, y: 0 } });
  m.edges.push({
    id: 'make',
    origin: 'a',
    target: 'p',
    logic: 'interaction',
    params: { k: 0.5, control_nodes: ['b', 'c'] },
  });
  return m;
}

describe('several controls on one interaction (control_nodes)', () => {
  it('travels in files and reaches the kernel', () => {
    const back = parseModel(serialiseModel(three())).model;
    expect(back.edges[0]?.params.control_nodes).toEqual(['b', 'c']);
    expect(toKernelModel(back).edges[0]).toMatchObject({
      params: { k: 0.5, control_nodes: ['b', 'c'] },
    });
    expect(validate(back).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('falls back to one control, then none, as controls are deleted, and follows renames', () => {
    const one = removeNode(three(), 'c');
    expect(one.edges[0]?.params).toEqual({ k: 0.5, control_node: 'b' });
    const none = removeNode(one, 'b');
    expect(none.edges[0]).toMatchObject({ logic: 'linear', params: { k: 0.5 } });
    expect(controlsOf(renameNode(three(), 'b', 'bee').edges[0]!)).toEqual(['bee', 'c']);
  });

  it('is refused on any logic but interaction, past eight, or beside control_node', () => {
    const m = three();
    m.edges[0]!.logic = 'ratio';
    expect(validate(m).map((i) => i.code)).toContain('controls-many');
    const both = three();
    both.edges[0]!.params.control_node = 'b';
    expect(validate(both).map((i) => i.code)).toContain('controls-both');
  });
});
