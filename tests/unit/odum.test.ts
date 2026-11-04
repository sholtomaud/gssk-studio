import { describe, expect, it } from 'vitest';
import { REFERENCE, referenceEntry, uncoveredTypes } from '../../src/assistant/odum.ts';
import { SYSTEM_PROMPT } from '../../src/assistant/conversation.ts';
import { callTool, modelBrief, TOOLS, type ToolContext } from '../../src/assistant/tools.ts';
import { LOGICS } from '../../src/model/catalogue.ts';
import { emptyModel } from '../../src/model/types.ts';

const text = (id: string) => referenceEntry(id)?.text ?? '';

describe('the Odum reference (ADR 0016)', () => {
  it('has an entry for every palette symbol, unique ids, and links that resolve', () => {
    expect(uncoveredTypes()).toEqual([]);
    const ids = REFERENCE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of REFERENCE) for (const id of e.see) expect(ids, `${e.id} → ${id}`).toContain(id);
  });

  it('states the rules the assistant got wrong before', () => {
    expect(text('heat-sink')).toMatch(/earth/);
    expect(text('heat-sink')).toMatch(/not a triangle|Mistakes\*\*: drawing it as a triangle/);
    expect(text('storage')).toMatch(/Every storage has a depreciation pathway/);
    expect(text('money')).toMatch(/never flows to a heat sink/);
    expect(text('materials')).toMatch(/conserved/);
  });

  it('takes the app’s own facts from the catalogue: kernel types and every flow logic', () => {
    expect(text('storage')).toMatch(/Kernel type `storage`/);
    expect(text('receiver')).toMatch(/Kernel type `loop_limited`/);
    for (const l of LOGICS) expect(text('logics')).toContain(l.formula);
  });

  it('is a tool the assistant is told to read before explaining', async () => {
    const tool = TOOLS.find((t) => t.name === 'odum_reference')!;
    const topics = (tool.parameters.properties.topic as { enum: string[] }).enum;
    expect(topics).toEqual(['index', ...REFERENCE.map((e) => e.id)]);
    expect(SYSTEM_PROMPT).toMatch(/odum_reference/);
    expect(SYSTEM_PROMPT).not.toMatch(/money depreciates/);

    const ctx: ToolContext = { draft: emptyModel(), steps: [], author: {} };
    const index = await callTool(ctx, 'odum_reference', { topic: 'index' });
    expect((index.result as { entries: unknown[] }).entries).toHaveLength(REFERENCE.length);
    const money = await callTool(ctx, 'odum_reference', { topic: 'money' });
    expect(money.result).toMatchObject({ id: 'money', title: 'Money' });
    expect((await callTool(ctx, 'odum_reference', { topic: 'phlogiston' })).ok).toBe(false);
    // Reading changes nothing.
    expect(ctx.steps).toEqual([]);
  });

  it('keeps money out of the heat sink: add_loss refuses, the brief does not ask', async () => {
    const m = emptyModel();
    m.carriers = [{ id: 'aud', _currency: 'AUD' }];
    m.nodes.push({
      id: 'bank',
      type: 'storage',
      value: 100,
      carrier: 'aud',
      visual: { x: 0, y: 0, label: 'Bank', capacity: 1000 },
    });
    expect(modelBrief(m)).not.toMatch(/no loss/);
    const ctx: ToolContext = { draft: m, steps: [], author: {} };
    const r = await callTool(ctx, 'add_loss', { from: 'bank', sink: null, k: null, why: null });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toMatch(/money does not go to a heat sink/);
    expect(ctx.draft).toBe(m);
  });
});
