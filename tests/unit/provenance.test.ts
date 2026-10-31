import { describe, expect, it } from 'vitest';
import { exampleById } from '../../src/model/examples/index.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { canonicalJson, toKernelModel } from '../../src/model/kernel-json.ts';
import { removeNode, renameNode, updateEdge } from '../../src/model/ops.ts';
import {
  assumedCount,
  inputKey,
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
