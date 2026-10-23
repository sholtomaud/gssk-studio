import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { addNode, connect } from '../../src/model/ops.ts';
import { cloneModel, emptyModel } from '../../src/model/types.ts';
import { hasErrors, validate } from '../../src/model/validate.ts';

const codes = (m: Parameters<typeof validate>[0]) => validate(m).map((i) => i.code);

describe('model checks (FR-VAL-001)', () => {
  it('passes every built-in example with no issues', () => {
    for (const ex of EXAMPLES) expect(validate(ex.model), ex.id).toEqual([]);
  });

  it('requires at least one node', () => {
    expect(codes(emptyModel())).toContain('empty');
  });

  it('names a flow whose logic needs a control node', () => {
    const m = cloneModel(EXAMPLES[1]!.model);
    delete m.edges[1]!.params.control_node;
    const issue = validate(m).find((i) => i.code === 'control-needed');
    expect(issue?.ref).toEqual({ kind: 'edge', id: 'predation' });
    expect(hasErrors(validate(m))).toBe(true);
  });

  it('catches missing endpoints, duplicate ids and bad run settings', () => {
    const m = cloneModel(EXAMPLES[0]!.model);
    m.edges[0]!.target = 'ghost';
    m.nodes[1]!.id = 'sun';
    m.config.dt = 0;
    expect(codes(m)).toEqual(expect.arrayContaining(['edge-end', 'node-dup', 'dt']));
  });

  it('refuses runs too long to finish in a browser', () => {
    const m = cloneModel(EXAMPLES[0]!.model);
    m.config.dt = 1e-6;
    expect(codes(m)).toContain('steps');
  });

  it('warns, without blocking, about isolated nodes and flows into a source', () => {
    let m = emptyModel();
    m = addNode(m, 'storage', { x: 0, y: 0 }, 'A').model;
    m = addNode(m, 'source', { x: 100, y: 0 }, 'S').model;
    m = addNode(m, 'storage', { x: 200, y: 0 }, 'Lonely').model;
    m = connect(m, 'a', 's').model;
    const issues = validate(m);
    expect(issues.map((i) => i.code).sort()).toEqual(['into-source', 'isolated']);
    expect(hasErrors(issues)).toBe(false);
  });

  it('requires C for a limit flow without a control node', () => {
    const m = cloneModel(EXAMPLES[2]!.model);
    const supply = m.edges.find((e) => e.id === 'supply')!;
    delete supply.params.threshold;
    expect(codes(m)).toContain('limit-needed');
  });
});
