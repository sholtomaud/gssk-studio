import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { normaliseModel, serialiseModel } from '../../src/model/io.ts';
import { cloneModel, type StudioModel } from '../../src/model/types.ts';
import { hasErrors, validate } from '../../src/model/validate.ts';
import { GsskModel, type NodeRef } from '../../src/sdk/gssk/builder.ts';
import * as ener from '../../src/sdk/energese/index.ts';
import { toEnergese } from '../../src/sdk/energese/codegen.ts';

const GENERATED = new URL('../fixtures/energese/generated/', import.meta.url);
/** Generated fixtures import the SDK by path, so `npm run typecheck` checks them. */
const FIXTURE_IMPORT = '../../../../src/sdk/energese/index.ts';

/** Run generated code: it is plain JavaScript apart from its import and export. */
function runScript(code: string): GsskModel {
  const body = code
    .replace(/^import \* as ener from .*;$/m, '')
    .replace(/^export default m;$/m, 'return m;');
  return new Function('ener', body)(ener) as GsskModel;
}

const normal = (m: StudioModel) => normaliseModel(cloneModel(m)).model;

/** Every symbol, every logic shape, and the awkward corners of the document. */
function kitchenSink(): StudioModel {
  return normal({
    metadata: {
      schema_version: 4,
      name: "Kitchen 'sink' \\ test",
      description: 'Line one\nline 2',
    },
    config: { t_start: 5, t_end: 50, dt: 0.25, method: 'euler' },
    nodes: [
      { id: 'sun', type: 'source', value: 100, visual: { x: 10, y: 20, label: 'Sun' } },
      {
        id: 'tank',
        type: 'storage',
        value: 3,
        carrier: 'water',
        params: { k: 2 },
        visual: { x: 1, y: 2, label: 'Tänk “A”', capacity: 50 },
      },
      { id: 'heat', type: 'sink', value: 0, visual: { x: 3, y: 4, label: 'Heat' } },
      { id: 'k1', type: 'constant', value: 7, visual: { x: 5, y: 6, label: 'k1' } },
      {
        id: 'grass',
        type: 'producer',
        value: 20,
        params: { k_production: 0.1, k_respiration: 0.02 },
        visual: { x: 7, y: 8, label: 'Grass' },
      },
      {
        id: 'cow',
        type: 'consumer',
        value: 5,
        params: { k_metabolism: 0.03 },
        visual: { x: 9, y: 10, label: 'Cow' },
      },
      { id: 'gate', type: 'interaction', value: 0, visual: { x: 11, y: 12, label: 'Gate' } },
      {
        id: 'market',
        type: 'exchange',
        value: 0,
        params: { price: 2, price_node: 'z.price-2' },
        visual: { x: 13, y: 14, label: 'Market' },
      },
      {
        id: 'sw',
        type: 'switch',
        value: 0,
        params: { threshold: 4 },
        visual: { x: 15, y: 16, label: 'Switch' },
      },
      {
        id: 'amp',
        type: 'gain',
        value: 0,
        params: { k: 3 },
        visual: { x: 17, y: 18, label: 'Amp' },
      },
      {
        id: 'rx',
        type: 'loop_limited',
        value: 0,
        params: { k: 1, C: 9 },
        visual: { x: 19, y: 20, label: 'Rx' },
      },
      { id: 'class', type: 'misc_box', value: 1, visual: { x: 21, y: 22, label: 'class' } },
      { id: 'z.price-2', type: 'storage', value: 1.5e-7, visual: { x: -3.5, y: 0, label: 'Sun' } },
    ],
    edges: [
      { id: 'sun_to_tank', origin: 'sun', target: 'tank', logic: 'linear', params: { k: 0.5 } },
      {
        id: 'fill',
        origin: 'sun',
        target: 'tank',
        logic: 'constant',
        params: { k: 1 },
        carrier: 'water',
        visual: { sensor: true, ctrl1: { x: 1, y: -2 }, ctrl2: { x: 0, y: 3 } },
      },
      { id: 'diffuse', origin: 'tank', target: 'class', logic: 'reversible', params: { k: 0.1 } },
      {
        id: 'graze',
        origin: 'grass',
        target: 'cow',
        logic: 'interaction',
        params: { k: 0.01, control_node: 'cow' },
      },
      {
        id: 'sub',
        origin: 'tank',
        target: 'heat',
        logic: 'subtract',
        params: { k: 1, control_node: 'k1' },
      },
      {
        id: 'th',
        origin: 'tank',
        target: 'heat',
        logic: 'threshold',
        params: { k: 1, threshold: 2 },
      },
      {
        id: 'lim_c',
        origin: 'sun',
        target: 'grass',
        logic: 'limit',
        params: { k: 1, control_node: 'k1' },
      },
      {
        id: 'lim_n',
        origin: 'sun',
        target: 'grass',
        logic: 'limit',
        params: { k: 1, threshold: 30 },
      },
      {
        id: 'lim_both',
        origin: 'sun',
        target: 'grass',
        logic: 'limit',
        params: { k: 1, control_node: 'k1', threshold: 30 },
      },
      {
        id: 'rat',
        origin: 'tank',
        target: 'heat',
        logic: 'ratio',
        params: { k: 1, control_node: 'k1', threshold: 0.1, numerator_node: 'class' },
      },
      {
        id: 'rat_plain',
        origin: 'tank',
        target: 'heat',
        logic: 'ratio',
        params: { k: 1, control_node: 'k1' },
      },
      {
        id: 'odd',
        origin: 'tank',
        target: 'heat',
        logic: 'linear',
        params: { k: -0.5, threshold: 1 },
      },
    ],
    _diagram: {
      boundaries: [
        { id: 'boundary', x: 0, y: 0, w: 100, h: 80, label: 'Farm' },
        { id: 'region-2', x: 5, y: 5, w: 10, h: 10, label: '' },
      ],
    },
  });
}

describe('Energese round trip (FR-SDK-002, FR-SDK-003)', () => {
  const cases: [string, StudioModel][] = [
    ...EXAMPLES.map((ex): [string, StudioModel] => [ex.id, normal(ex.model)]),
    ['every symbol and logic', kitchenSink()],
  ];
  for (const [name, model] of cases) {
    it(`${name}: generated code synthesizes the same file, byte for byte`, () => {
      const script = runScript(toEnergese(model));
      // Observations are data, not structure: the code leaves them out, and
      // synthesizing over the previous model keeps them (FR-SDK-004).
      const { _observations, ...structure } = model;
      expect(serialiseModel(script.synth())).toBe(serialiseModel(structure));
      expect(serialiseModel(script.synth({ previous: model }))).toBe(serialiseModel(model));
    });
  }

  it('writes ids only where the label would not give the same one', () => {
    const code = toEnergese(normal(EXAMPLES[0]!.model));
    expect(code).toContain(
      "new ener.Producer(m, 'Grass', { value: 20, at: [330, 260], capacity: 200 })"
    );
    expect(code).toContain("new ener.Source(m, 'Sunlight', { id: 'sun', value: 100");
  });

  it('uses the helper for each logic, and ener.logic where none fits', () => {
    const code = toEnergese(kitchenSink());
    expect(code).toContain('ener.interaction(0.01, cow)');
    expect(code).toContain('ener.limit(1, k1)');
    expect(code).toContain('ener.limit(1, 30)');
    expect(code).toContain("ener.logic('limit', { k: 1, control: k1, threshold: 30 })");
    expect(code).toContain('ener.ratio(1, k1, { numerator: class2, floor: 0.1 })');
    expect(code).toContain("ener.logic('linear', { k: -0.5, threshold: 1 })");
    // A node declared later is named by id; a reserved word is not a variable name.
    expect(code).toContain("priceNode: 'z.price-2'");
    expect(code).toContain('const class2 = new ener.Box(');
  });

  it('keeps the checked-in generated examples current (they are type-checked by tsc)', () => {
    mkdirSync(GENERATED, { recursive: true });
    for (const ex of EXAMPLES) {
      const file = new URL(`${ex.id}.energese.ts`, GENERATED);
      const code = toEnergese(normal(ex.model), { importFrom: FIXTURE_IMPORT });
      if (process.env.UPDATE_ENERGESE) writeFileSync(file, code);
      expect(readFileSync(file, 'utf8')).toBe(code);
    }
  });

  it('runs a checked-in generated example as a real module', async () => {
    const ex = EXAMPLES[0]!;
    expect(ex.id).toBe('grassland');
    const mod = (await import('../fixtures/energese/generated/grassland.energese.ts')) as {
      default: GsskModel;
    };
    expect(serialiseModel(mod.default.synth())).toBe(serialiseModel(normal(ex.model)));
  });
});

describe('scripts as generators (ADR 0009, FR-SDK-004, FR-SDK-005)', () => {
  it('builds a valid model from a hand-written script with a loop', async () => {
    const mod = (await import('../fixtures/energese/food-chain.energese.ts')) as {
      default: GsskModel;
    };
    const m = mod.default.synth();
    expect(hasErrors(validate(m))).toBe(false);
    expect(m.nodes.map((n) => n.id)).toEqual([
      'sun',
      'heat',
      'level_1',
      'level_2',
      'level_3',
      'level_4',
    ]);
  });

  it('lays out unplaced nodes left to right, sinks below, none overlapping', () => {
    const m = new ener.Model('Chain');
    const sun = new ener.Source(m, 'Sun', { value: 10 });
    const a = new ener.Storage(m, 'A');
    const b = new ener.Storage(m, 'B');
    const c = new ener.Storage(m, 'C');
    const heat = new ener.HeatSink(m, 'Heat');
    new ener.Flow(m, sun, a, ener.linear(1));
    new ener.Flow(m, sun, b, ener.linear(1));
    new ener.Flow(m, a, c, ener.linear(1));
    for (const n of [a, b, c]) new ener.Flow(m, n, heat, ener.linear(0.1));
    const s = m.synth();
    const at = (id: string) => s.nodes.find((n) => n.id === id)!.visual;
    expect(at('sun').x).toBeLessThan(at('a').x);
    expect(at('a').x).toBe(at('b').x);
    expect(at('a').x).toBeLessThan(at('c').x);
    expect(at('heat').y).toBeGreaterThan(Math.max(...['sun', 'a', 'b', 'c'].map((id) => at(id).y)));
    for (const p of s.nodes)
      for (const q of s.nodes)
        if (p !== q)
          expect(
            Math.abs(p.visual.x - q.visual.x) >= 150 || Math.abs(p.visual.y - q.visual.y) >= 120
          ).toBe(true);
  });

  it('keeps positions, curves and observations from the model it replaces', () => {
    const previous = normal(EXAMPLES[0]!.model);
    previous.edges[0]!.visual = { ctrl1: { x: 4, y: 5 } };
    previous._observations = [
      { id: 'o1', name: 'grass obs', target: 'grass', times: [0, 1], values: [20, 21] },
      { id: 'o2', name: 'gone', target: 'grazers', times: [0], values: [1] },
    ];
    const m = new ener.Model('Grassland, rescripted');
    const sun = new ener.Source(m, 'Sunlight', { id: 'sun', value: 100 });
    const grass = new ener.Producer(m, 'Grass', { value: 20 });
    const moved = new ener.HeatSink(m, 'Heat', { at: [999, 999] });
    new ener.Flow(m, sun, grass, ener.linear(0.02), { id: 'photosynthesis' });
    new ener.Flow(m, grass, moved, ener.linear(0.01), { id: 'grass_loss' });
    const s = m.synth({ previous });
    const was = (id: string) => previous.nodes.find((n) => n.id === id)!.visual;
    expect(s.nodes[0]!.visual).toEqual(was('sun'));
    expect(s.nodes[1]!.visual).toEqual(was('grass'));
    expect(s.nodes[2]!.visual).toMatchObject({ x: 999, y: 999 });
    expect(s.edges[0]!.visual).toEqual({ ctrl1: { x: 4, y: 5 } });
    expect(s._observations?.map((o) => o.target)).toEqual(['grass', null]);
  });

  it('refuses a duplicate explicit id and a node from another model', () => {
    const m = new ener.Model('A');
    new ener.Storage(m, 'X', { id: 'x' });
    expect(() => new ener.Storage(m, 'Y', { id: 'x' })).toThrow(/already used/);
    const other = new ener.Model('B');
    const stranger = new ener.Storage(other, 'S');
    const mine = new ener.Storage(m, 'Mine');
    expect(() => new ener.Flow(m, mine, stranger, ener.linear(1))).toThrow(/another model/);
  });
});

describe('domain libraries over the neutral builder (ADR 0010)', () => {
  /** A third-party construct: a logistic population, written without Energese. */
  function logisticPopulation(
    model: GsskModel,
    name: string,
    o: { r: number; K: number; n0: number }
  ): NodeRef {
    const supply = model.addNode('source', `${name} supply`, { value: 1 });
    const pop = model.addNode('storage', name, { value: o.n0 });
    model.addEdge(supply, pop, 'limit', { k: o.r, threshold: o.K });
    return pop;
  }

  it('composes with Energese constructs and round-trips through generated code', () => {
    const m = new GsskModel('Mixed');
    const fish = logisticPopulation(m, 'Fish', { r: 0.4, K: 500, n0: 10 });
    const sea = new ener.HeatSink(m, 'Sea');
    new ener.Flow(m, fish, sea, ener.linear(0.05));
    const s = m.synth();
    expect(hasErrors(validate(s))).toBe(false);
    expect(serialiseModel(runScript(toEnergese(s)).synth())).toBe(serialiseModel(s));
  });
});
