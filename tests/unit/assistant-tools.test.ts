import { describe, expect, it } from 'vitest';
import { callTool, TOOLS, type ToolContext } from '../../src/assistant/tools.ts';
import { assumedCount, marksFor } from '../../src/model/provenance.ts';
import { emptyModel } from '../../src/model/types.ts';
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
});
