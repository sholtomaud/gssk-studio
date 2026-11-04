import { describe, expect, it } from 'vitest';
import { exampleById } from '../../src/model/examples/index.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { toKernelModel } from '../../src/model/kernel-json.ts';
import { removeNode, removeSelection, renameNode, updateEdge } from '../../src/model/ops.ts';
import {
  createProcess,
  describeProcess,
  findProcess,
  flowToProcess,
  opMark,
  pathways,
  removeControl,
  setControlUsed,
  setOp,
  setProduct,
  wireIn,
} from '../../src/model/processes.ts';
import { cloneModel, controlsOf, emptyModel, type StudioModel } from '../../src/model/types.ts';
import { validate } from '../../src/model/validate.ts';

/** Sun and nutrients into grass: A (left), B (control), P (product). */
function parts(): StudioModel {
  const m = emptyModel();
  m.nodes.push(
    { id: 'sun', type: 'source', value: 100, visual: { x: 0, y: 100, label: 'Sun' } },
    {
      id: 'nutrients',
      type: 'storage',
      value: 5,
      visual: { x: 200, y: 0, label: 'Nutrients', capacity: 10 },
    },
    {
      id: 'grass',
      type: 'storage',
      value: 1,
      visual: { x: 400, y: 100, label: 'Grass', capacity: 100 },
    }
  );
  return m;
}

function built() {
  const { model, id } = createProcess(parts(), { x: 200, y: 100 });
  let m = wireIn(model, id, 'sun');
  m = wireIn(m, id, 'nutrients');
  m = setProduct(m, id, 'grass');
  return { m, id };
}

describe('interaction processes (ADR 0018)', () => {
  it('has no flows until it has an input, a control and a product, and says what it needs', () => {
    const { model, id } = createProcess(parts(), { x: 200, y: 100 });
    expect(model.edges).toEqual([]);
    expect(validate(model).find((i) => i.code === 'process-incomplete')?.message).toMatch(
      /needs a main input, a control or second input, a product target/
    );
    expect(findProcess(model, id)?.controls).toEqual([]);
  });

  it('makes the product and used-energy pathways, with the same production function', () => {
    const { m, id } = built();
    const p = pathways(m, id);
    expect(p.product).toMatchObject({
      origin: 'sun',
      target: 'grass',
      logic: 'interaction',
      params: { k: 0.1, control_node: 'nutrients' },
    });
    expect(p.heat).toMatchObject({
      origin: 'sun',
      logic: 'interaction',
      params: { k: 0.01, control_node: 'nutrients' },
    });
    // No heat sink in the model: a new one, below the chevron.
    const sink = m.nodes.find((n) => n.id === p.heat!.target)!;
    expect(sink).toMatchObject({ type: 'sink', visual: { x: 200, y: 240 } });
    expect(p.uses.size).toBe(0);
    expect(validate(m).filter((i) => i.severity === 'error')).toEqual([]);
    expect(describeProcess(m, findProcess(m, id)!)).toBe('Sun × Nutrients (read) → Grass');
  });

  it('draws a used-up control down in proportion to production', () => {
    const { m, id } = built();
    const used = setControlUsed(m, id, 'nutrients', true);
    const use = pathways(used, id).uses.get('nutrients')!;
    expect(use).toMatchObject({
      origin: 'nutrients',
      logic: 'interaction',
      params: { control_node: 'sun' },
    });
    expect(use.target).toBe(pathways(used, id).heat!.target);
    expect(pathways(setControlUsed(used, id, 'nutrients', false), id).uses.size).toBe(0);
  });

  it('multiplies three inputs, divides or subtracts by one, and keeps each pathway’s k', () => {
    const { m, id } = built();
    const product = pathways(m, id).product!;
    const tuned = updateEdge(m, product.id, (e) => (e.params.k = 0.3));
    const m3 = wireIn(
      {
        ...tuned,
        nodes: [
          ...tuned.nodes,
          { id: 'water', type: 'source', value: 2, visual: { x: 200, y: -100 } },
        ],
      },
      id,
      'water'
    );
    const p3 = pathways(m3, id).product!;
    expect(controlsOf(p3)).toEqual(['nutrients', 'water']);
    expect(p3.params.k).toBe(0.3);
    expect(opMark(findProcess(m3, id)!)).toBe('* *');
    // A divisor takes one control: with two it is an error and has no flows.
    const div = setOp(m3, id, 'divide');
    expect(validate(div).map((i) => i.code)).toContain('process-controls');
    expect(pathways(div, id).product).toBeUndefined();
    const div1 = removeControl(div, id, 'water');
    expect(pathways(div1, id).product).toMatchObject({
      logic: 'ratio',
      params: { k: 0.3, control_node: 'nutrients' },
    });
  });

  it('turns a flow into a process: the grazers feeding back to their own grazing', () => {
    const grass = cloneModel(exampleById('grassland')!.model);
    const flow = grass.edges.find((e) => e.origin === 'grass' && e.target === 'grazers')!;
    const plain = {
      ...grass,
      edges: grass.edges.map((e) =>
        e === flow ? { ...e, logic: 'linear' as const, params: { k: e.params.k } } : e
      ),
    };
    const { model, id } = flowToProcess(plain, flow.id, 'grazers', { x: 500, y: 200 });
    expect(id).not.toBeNull();
    const p = pathways(model, id!);
    expect(p.product?.id).toBe(flow.id);
    expect(p.product).toMatchObject({
      logic: 'interaction',
      params: { control_node: 'grazers', k: flow.params.k },
    });
    // The example's heat sink, below the chevron, takes the used energy.
    expect(p.heat?.target).toBe('heat');
    expect(validate(model).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('follows deletions and renames, and goes with its own pathways', () => {
    const { m, id } = built();
    const gone = removeNode(m, 'nutrients');
    expect(findProcess(gone, id)?.controls).toEqual([]);
    expect(pathways(gone, id).product).toBeUndefined();
    const renamed = renameNode(m, 'nutrients', 'soil');
    expect(findProcess(renamed, id)?.controls[0]?.node).toBe('soil');
    expect(controlsOf(pathways(renamed, id).product!)).toEqual(['soil']);
    const removed = removeSelection(m, { kind: 'edge', id: pathways(m, id).product!.id });
    expect(findProcess(removed, id)).toBeUndefined();
    expect(removed.edges).toEqual([]);
  });

  it('travels in the file; the kernel sees only its flows', () => {
    const { m, id } = built();
    const back = parseModel(serialiseModel(setControlUsed(m, id, 'nutrients', true))).model;
    expect(findProcess(back, id)).toEqual(
      findProcess(setControlUsed(m, id, 'nutrients', true), id)
    );
    expect(pathways(back, id).uses.size).toBe(1);
    const k = JSON.stringify(toKernelModel(back));
    expect(k).not.toContain('"process"');
    expect(toKernelModel(back).edges).toHaveLength(3);
  });
});
