import { describe, expect, it } from 'vitest';
import { callTool, TOOLS, type ToolContext } from '../../src/assistant/tools.ts';
import { assumedCount, inputKey, markInputs, marksFor } from '../../src/model/provenance.ts';
import { exampleById } from '../../src/model/examples/index.ts';
import { cloneModel, emptyModel, type StudioModel } from '../../src/model/types.ts';
import type { CalibrationResult } from '../../src/fit/calibrate.ts';
import { hasErrors, validate } from '../../src/model/validate.ts';
import { toKernelModel } from '../../src/model/kernel-json.ts';

const AT = '2026-10-31T00:00:00.000Z';

function context(): ToolContext {
  return {
    draft: emptyModel(),
    steps: [],
    author: { provider: 'local', model: 'test-model' },
    now: () => AT,
  };
}

/** Call a tool and expect it to work. */
async function ok(ctx: ToolContext, name: string, args: Record<string, unknown>) {
  const r = await callTool(ctx, name, args);
  expect(r.ok, JSON.stringify(r.result)).toBe(true);
  return r.result as Record<string, unknown>;
}

describe('the assistant’s tools (M12, ADR 0016)', () => {
  it('offers strict schemas: every property listed and required, nothing else allowed', () => {
    for (const t of TOOLS) {
      expect(t.parameters.additionalProperties, t.name).toBe(false);
      expect(t.parameters.required.sort(), t.name).toEqual(
        Object.keys(t.parameters.properties).sort()
      );
    }
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });

  it('builds a home that buys water, step by step, on a draft, marking every number it sets', async () => {
    const ctx = context();
    await ok(ctx, 'add_carrier', { id: 'water', label: 'Water', unit: 'kL', currency: null });
    await ok(ctx, 'add_carrier', {
      id: 'aud',
      label: 'Australian dollar',
      unit: null,
      currency: 'AUD',
    });
    const dam = await ok(ctx, 'add_symbol', {
      type: 'storage',
      label: 'Utility dam',
      x: null,
      y: null,
      value: 5000,
      capacity: null,
      carrier: 'water',
      why: 'a small town dam, in kL',
    });
    expect(dam.id).toBe('utility_dam');
    const tank = await ok(ctx, 'add_symbol', {
      type: 'storage',
      label: 'Water tank',
      x: null,
      y: null,
      value: null,
      capacity: null,
      carrier: 'water',
      why: null,
    });
    const supply = await ok(ctx, 'connect', {
      from: 'utility_dam',
      to: tank.id,
      logic: 'constant',
      k: 15,
      carrier: 'water',
      why: 'a household uses about 15 kL a month',
    });
    await ok(ctx, 'add_transaction', { flow: supply.id, purpose: '04' });
    const bill = await ok(ctx, 'add_counter_flow', {
      flow: supply.id,
      payer: null,
      payee: null,
      currency: 'aud',
      k: 45,
      why: 'about $3 a kL',
    });
    await ok(ctx, 'group', { ids: ['water_tank', 'payer_money'], label: 'Home', packed: true });

    const m = ctx.draft;
    expect(hasErrors(validate(m))).toBe(false);
    expect(ctx.steps).toHaveLength(8);
    expect(ctx.steps[0]).toMatch(/Declare carrier “Water”/);
    // The person's numbers left alone; the assistant's three marked, with why.
    expect(assumedCount(m)).toBe(3);
    expect(marksFor(m, 'edge', String(supply.id))).toEqual([
      {
        field: 'params.k',
        mark: {
          by: 'assistant',
          at: AT,
          provider: 'local',
          model: 'test-model',
          why: 'a household uses about 15 kL a month',
        },
      },
    ]);
    expect(marksFor(m, 'edge', String(bill.id))[0]?.mark.why).toBe('about $3 a kL');
    expect(marksFor(m, 'node', 'water_tank')).toEqual([]);
    // The kernel gets the water flow and the bill, paired.
    const k = toKernelModel(m);
    expect(k.edges.find((e) => e.id === supply.id)).toMatchObject({
      coupled_edge: bill.id,
      carrier: 'water',
    });
  });

  it('refuses what is not there, changing nothing and saying why', async () => {
    const ctx = context();
    const before = ctx.draft;
    const r = await callTool(ctx, 'connect', {
      from: 'sun',
      to: 'tank',
      logic: null,
      k: null,
      carrier: null,
      why: null,
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toMatch(/no symbol “sun”/);
    expect(ctx.draft).toBe(before);
    expect(ctx.steps).toEqual([]);
    expect((await callTool(ctx, 'teleport', {})).ok).toBe(false);
    const bad = await callTool(ctx, 'add_symbol', {
      type: 'exchange',
      label: 'X',
      x: 0,
      y: 0,
      value: null,
      capacity: null,
      carrier: null,
      why: null,
    });
    expect(JSON.stringify(bad.result)).toMatch(/not a symbol type you can add/);
  });

  it('answers every edit with the app’s own checks, so it learns what is valid', async () => {
    const ctx = context();
    const add = (label: string) =>
      ok(ctx, 'add_symbol', {
        type: 'storage',
        label,
        x: null,
        y: null,
        value: null,
        capacity: null,
        carrier: null,
        why: null,
      });
    await add('Tank');
    const r = await add('Pond');
    expect((r.checks as { warnings: string[] }).warnings.join(' ')).toMatch(
      /“Tank” is not connected/
    );
  });

  it('runs on the kernel only through the app, and only when the checks pass', async () => {
    const ctx = context();
    expect((await callTool(ctx, 'run_model', {})).ok).toBe(false);
    ctx.run = async () => ({
      runId: 'abc',
      steps: 10,
      method: 'rk4',
      assumedInputs: 0,
      solverConfident: true,
      final: { tank: 1 },
    });
    expect(JSON.stringify((await callTool(ctx, 'run_model', {})).result)).toMatch(
      /Add at least one symbol/
    );
    await ok(ctx, 'add_symbol', {
      type: 'storage',
      label: 'Tank',
      x: 0,
      y: 0,
      value: null,
      capacity: null,
      carrier: null,
      why: null,
    });
    const run = await ok(ctx, 'run_model', {});
    expect(run.runId).toBe('abc');
    expect(await ok(ctx, 'get_run_summary', {})).toEqual(run);
  });

  it('describes the model with what it may add and how flows work', async () => {
    const d = await ok(context(), 'describe_model', {});
    expect((d.symbolTypes as { type: string }[]).map((x) => x.type)).toContain('storage');
    expect((d.logics as { logic: string }[]).map((x) => x.logic)).toContain('interaction');
  });

  it('adds an interaction as a process: product, used energy, a used-up ingredient, marked rates (ADR 0018)', async () => {
    const ctx = context();
    const add = (type: string, label: string) =>
      ok(ctx, 'add_symbol', {
        type,
        label,
        x: null,
        y: null,
        value: null,
        capacity: null,
        carrier: null,
        why: null,
      });
    await add('source', 'Sun');
    await add('storage', 'Nutrients');
    await add('storage', 'Grass');
    const r = await ok(ctx, 'add_interaction', {
      input: 'sun',
      controls: [{ node: 'nutrients', used: true }],
      product: 'grass',
      op: 'product',
      k: 0.02,
      heat_k: null,
      label: 'Photosynthesis',
      why: 'a guess',
    });
    const ways = r.pathways as { product: string; heat: string; uses: string[] };
    expect(ways.uses).toHaveLength(1);
    expect(ctx.steps.at(-1)).toBe('Add interaction: Sun × Nutrients → Grass');
    expect(ctx.draft.edges.find((e) => e.id === ways.product)?.params.k).toBe(0.02);
    expect(assumedCount(ctx.draft)).toBe(1);
    const d = (await ok(ctx, 'describe_model', {})) as { interactions: { reads: string }[] };
    expect(d.interactions[0]?.reads).toBe('Sun × Nutrients → Grass');
    // Removing a pathway removes the interaction it belongs to.
    await ok(ctx, 'remove', { kind: 'edge', id: ways.heat });
    expect(ctx.draft._diagram.processes).toBeUndefined();
    expect(ctx.draft.edges).toEqual([]);
  });

  it('set_control turns a flow into a process with a read-only control', async () => {
    const ctx = context();
    for (const [type, label] of [
      ['storage', 'Grass'],
      ['consumer', 'Grazers'],
    ] as const)
      await ok(ctx, 'add_symbol', {
        type,
        label,
        x: null,
        y: null,
        value: null,
        capacity: null,
        carrier: null,
        why: null,
      });
    const flow = await ok(ctx, 'connect', {
      from: 'grass',
      to: 'grazers',
      logic: null,
      k: null,
      carrier: null,
      why: null,
    });
    const r = await ok(ctx, 'set_control', { flow: flow.id, control: 'grazers' });
    expect(r.process).toBeTruthy();
    expect(ctx.draft._diagram.processes?.[0]?.controls).toEqual([{ node: 'grazers', used: false }]);
    expect(ctx.draft.edges.find((e) => e.id === flow.id)).toMatchObject({
      logic: 'interaction',
      params: { control_node: 'grazers' },
    });
  });
});

/** The reservoir example, whose observations calibration can fit. */
function reservoir(): StudioModel {
  return cloneModel(exampleById('reservoir')!.model);
}

const fit = (rmse: number) => ({
  n: 11,
  excluded: 0,
  rmse,
  mae: rmse,
  bias: 0,
  r2: 1,
  nse: 1,
  kge: 1,
});

describe('calibrate: fit rates through the app’s calibration (ADR 0016, FR-CAL-001)', () => {
  /** A stand-in for the sim worker: halves each rate, and reports how the fit improved. */
  function fake(seen: { ids: string[]; iterations: number }[] = []): ToolContext['calibrate'] {
    return async (m, ids, iterations) => {
      seen.push({ ids, iterations });
      return {
        rates: ids.map((edgeId) => {
          const k = m.edges.find((e) => e.id === edgeId)!.params.k;
          return { edgeId, before: k, after: k / 2, se: 0.001, informed: true };
        }),
        fits: [
          {
            obsId: 'o',
            name: 'Reservoir level',
            target: 'reservoir',
            before: fit(9),
            after: fit(1),
          },
        ],
        sseBefore: 81,
        sseAfter: 1,
        iterations: 7,
        runs: 30,
        stop: 'converged',
        model: m,
      } satisfies CalibrationResult;
    };
  }

  it('sets the fitted rates on the draft, marked by calibration, not as the assistant’s guess', async () => {
    const seen: { ids: string[]; iterations: number }[] = [];
    const ctx = { ...context(), draft: reservoir(), calibrate: fake(seen) };
    const flow = ctx.draft.edges[0]!;
    const before = flow.params.k;
    markInputs(ctx.draft, [inputKey('edge', flow.id, 'params.k')], {
      by: 'assistant',
      at: AT,
      why: 'a guess',
    });
    const r = await ok(ctx, 'calibrate', { flows: [flow.id], max_iterations: null });
    expect(seen).toEqual([{ ids: [flow.id], iterations: 40 }]);
    expect(r).toMatchObject({
      rates: [{ flow: flow.id, before, after: before / 2, informed: true }],
      sseBefore: 81,
      sseAfter: 1,
      stop: 'converged',
    });
    expect(ctx.draft.edges[0]!.params.k).toBe(before / 2);
    const [mark] = marksFor(ctx.draft, 'edge', flow.id);
    expect(mark?.mark).toMatchObject({ by: 'calibration', at: AT });
    expect(mark?.mark.why).toContain('Reservoir level');
    expect(assumedCount(ctx.draft)).toBe(0);
    expect(ctx.steps).toEqual([`Calibrate ${flow.id} to Reservoir level`]);
  });

  it('refuses without observations or a way to calibrate, and names flows that are not there', async () => {
    const empty = { ...context(), calibrate: fake() };
    const none = await callTool(empty, 'calibrate', { flows: ['x'], max_iterations: null });
    expect(none.ok).toBe(false);
    expect(JSON.stringify(none.result)).toContain('There is no flow');

    const unrunnable = { ...context(), draft: reservoir() };
    const off = await callTool(unrunnable, 'calibrate', {
      flows: [unrunnable.draft.edges[0]!.id],
      max_iterations: null,
    });
    expect(JSON.stringify(off.result)).toContain('not available');

    const failing = {
      ...context(),
      draft: reservoir(),
      calibrate: async () => {
        throw new Error('Compare at least one observation series with a symbol first');
      },
    };
    const r = await callTool(failing, 'calibrate', {
      flows: [failing.draft.edges[0]!.id],
      max_iterations: 5,
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toContain('observation series');
    expect(failing.steps).toEqual([]);
  });
});

describe('propose_energese: a script the app runs in its sandbox (ADR 0016, ADR 0013)', () => {
  it('makes what the script builds the draft, keeps marks on unchanged inputs, and marks the ones it changed', async () => {
    const ctx = context();
    ctx.draft = cloneModel(exampleById('grassland')!.model);
    const [kept, changed] = ctx.draft.edges;
    markInputs(ctx.draft, [inputKey('edge', kept!.id, 'params.k')], {
      by: 'assistant',
      at: AT,
      why: 'earlier guess',
    });
    const seen: string[] = [];
    ctx.runEnergese = async (source, previous) => {
      seen.push(source);
      const built = cloneModel(previous);
      delete built._provenance;
      built.edges.find((e) => e.id === changed!.id)!.params.k = 0.42;
      built.nodes.push({ ...structuredClone(built.nodes[0]!), id: 'extra', value: 3 });
      return { ok: true, model: built, logs: ['built'] };
    };
    const r = await ok(ctx, 'propose_energese', {
      source: 'export default m;',
      why: 'a faster grazing rate',
    });
    expect(seen).toEqual(['export default m;']);
    expect(r).toMatchObject({ symbols: ctx.draft.nodes.length, logs: ['built'] });
    expect(ctx.draft.edges.find((e) => e.id === changed!.id)!.params.k).toBe(0.42);
    expect(marksFor(ctx.draft, 'edge', kept!.id)[0]?.mark.why).toBe('earlier guess');
    expect(marksFor(ctx.draft, 'edge', changed!.id)[0]?.mark).toMatchObject({
      by: 'assistant',
      why: 'a faster grazing rate',
    });
    expect(marksFor(ctx.draft, 'node', 'extra').map((x) => x.field)).toEqual(['value']);
    expect(ctx.steps).toEqual([
      `Build from an Energese script: ${ctx.draft.nodes.length} symbols, ${ctx.draft.edges.length} flows`,
    ]);
  });

  it('answers a script that does not build with its problems, and changes nothing', async () => {
    const ctx = context();
    const before = ctx.draft;
    ctx.runEnergese = async () => ({
      ok: false,
      problems: ["script.ts 2:7  Type 'string' is not assignable to type 'number'."],
      logs: [],
    });
    const r = await callTool(ctx, 'propose_energese', { source: 'x', why: null });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toContain('not assignable');
    expect(ctx.draft).toBe(before);
    expect(ctx.steps).toEqual([]);
    const off = await callTool(context(), 'propose_energese', { source: 'x', why: null });
    expect(JSON.stringify(off.result)).toContain('not available');
  });
});
