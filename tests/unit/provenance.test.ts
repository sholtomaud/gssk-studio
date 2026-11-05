import { describe, expect, it } from 'vitest';
import { exampleById } from '../../src/model/examples/index.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { canonicalJson, toKernelModel } from '../../src/model/kernel-json.ts';
import { removeNode, renameNode, updateEdge } from '../../src/model/ops.ts';
import {
  assumedCount,
  citeInput,
  inputKey,
  inputKeys,
  sourceCounts,
  uncite,
  inputValue,
  markInputs,
  marksFor,
  reconcileMarks,
} from '../../src/model/provenance.ts';
import { cloneModel, type StudioModel } from '../../src/model/types.ts';
import { validate } from '../../src/model/validate.ts';

const AT = '2026-10-31T00:00:00.000Z';
const assistant = { by: 'assistant' as const, at: AT, model: 'test', why: 'a typical rate' };

/** The grassland example with the assistant's guess at its photosynthesis rate. */
function guessed(): StudioModel {
  const m = cloneModel(exampleById('grassland')!.model);
  markInputs(m, [inputKey('edge', m.edges[0]!.id, 'params.k')], assistant);
  return m;
}

describe('inputs the assistant set (NFR-HON-002, ADR 0016)', () => {
  it('names an input by key and reads its value', () => {
    const m = guessed();
    const e = m.edges[0]!;
    expect(inputValue(m, `edge:${e.id}:params.k`)).toBe(e.params.k);
    expect(inputValue(m, 'node:sun:value')).toBe(m.nodes.find((n) => n.id === 'sun')?.value);
    expect(inputValue(m, 'node:nowhere:value')).toBeUndefined();
  });

  it('counts the assumptions and says so in the checks, without changing what the kernel runs', () => {
    const m = guessed();
    expect(assumedCount(m)).toBe(1);
    const info = validate(m).filter((i) => i.code === 'assumed');
    expect(info).toHaveLength(1);
    expect(info[0]?.severity).toBe('info');
    expect(info[0]?.message).toMatch(/1 value was set by the assistant/);
    const plain = cloneModel(exampleById('grassland')!.model);
    expect(canonicalJson(toKernelModel(m))).toBe(canonicalJson(toKernelModel(plain)));
  });

  it('makes a hand edit of a marked value the person’s, and leaves other edits alone', () => {
    const m = guessed();
    const id = m.edges[0]!.id;
    const key = `edge:${id}:params.k`;
    const edited = reconcileMarks(
      m,
      updateEdge(m, id, (e) => (e.params.k = 0.05)),
      'user',
      AT
    );
    expect(edited._provenance?.[key]).toEqual({ by: 'user', at: AT });
    expect(assumedCount(edited)).toBe(0);
    // An edit that does not touch the value keeps the mark, and the model object.
    const other = updateEdge(m, id, (e) => (e.visual = { sensor: true }));
    expect(reconcileMarks(m, other, 'user')).toBe(other);
    // Calibration replaces it too.
    const fitted = reconcileMarks(
      m,
      updateEdge(m, id, (e) => (e.params.k = 0.03)),
      'calibration',
      AT
    );
    expect(fitted._provenance?.[key]?.by).toBe('calibration');
  });

  it('keeps a new mark the edit set itself, and drops marks on inputs that are gone', () => {
    const m = guessed();
    const id = m.edges[0]!.id;
    const next = updateEdge(m, id, (e) => (e.params.k = 0.2));
    markInputs(next, [`edge:${id}:params.k`], { ...assistant, why: 'a second guess' });
    expect(reconcileMarks(m, next, 'user')._provenance?.[`edge:${id}:params.k`]?.why).toBe(
      'a second guess'
    );
    const origin = m.edges[0]!.origin;
    const gone = reconcileMarks(m, removeNode(m, origin), 'user');
    expect(gone._provenance).toBeUndefined();
  });

  it('follows a renamed symbol, and travels in the model file', () => {
    const m = cloneModel(exampleById('grassland')!.model);
    markInputs(m, ['node:grass:value'], assistant);
    const renamed = renameNode(m, 'grass', 'meadow');
    expect(marksFor(renamed, 'node', 'meadow')).toEqual([{ field: 'value', mark: assistant }]);
    const back = parseModel(serialiseModel(renamed)).model;
    expect(back._provenance).toEqual(renamed._provenance);
  });
});

describe('numbers from cited data (ADR 0017)', () => {
  const source = {
    dataset: 'ABS 5206.0 Australian National Accounts',
    table: 'Table 2',
    url: 'https://www.abs.gov.au/statistics/economy/national-accounts',
    retrieved: '2026-11-01',
    licence: 'CC BY 4.0',
  };

  it('counts every input once by where it comes from', () => {
    const m = guessed();
    const total = inputKeys(m).length;
    expect(total).toBeGreaterThan(2);
    const c0 = sourceCounts(m);
    expect(c0).toEqual({ cited: 0, calibrated: 0, assumed: 1, unsourced: total - 1 });
    const key = inputKeys(m).find((k) => k.startsWith('node:') && k.endsWith(':value'))!;
    const cited = citeInput(m, key, source, AT);
    expect(cited._provenance?.[key]).toEqual({ by: 'data', at: AT, source });
    expect(sourceCounts(cited)).toEqual({
      cited: 1,
      calibrated: 0,
      assumed: 1,
      unsourced: total - 2,
    });
    expect(m._provenance?.[key]).toBeUndefined();
  });

  it('refuses a citation with no dataset or for an input that is not there, and drops blank fields', () => {
    const m = guessed();
    expect(citeInput(m, 'node:nowhere:value', source)).toBe(m);
    expect(citeInput(m, 'node:sun:value', { dataset: '  ' })).toBe(m);
    const c = citeInput(m, 'node:sun:value', { dataset: 'BoM solar exposure', url: '' }, AT);
    expect(c._provenance?.['node:sun:value']?.source).toEqual({ dataset: 'BoM solar exposure' });
  });

  it('keeps a citation through a file, and loses it when the value is edited by hand', () => {
    const m = citeInput(guessed(), 'node:sun:value', source, AT);
    const back = parseModel(serialiseModel(m)).model;
    expect(back._provenance?.['node:sun:value']).toEqual({ by: 'data', at: AT, source });
    const edited = reconcileMarks(
      back,
      { ...back, nodes: back.nodes.map((n) => (n.id === 'sun' ? { ...n, value: 7 } : n)) },
      'user',
      AT
    );
    expect(edited._provenance?.['node:sun:value']).toEqual({ by: 'user', at: AT });
  });

  it('removes a citation, leaving the value', () => {
    const m = citeInput(cloneModel(exampleById('grassland')!.model), 'node:sun:value', source, AT);
    const u = uncite(m, 'node:sun:value');
    expect(u._provenance).toBeUndefined();
    expect(inputValue(u, 'node:sun:value')).toBe(inputValue(m, 'node:sun:value'));
    expect(uncite(u, 'node:sun:value')).toBe(u);
  });
});
