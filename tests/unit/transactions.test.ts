import { describe, expect, it } from 'vitest';
import {
  carrierProblems,
  conservedOf,
  isCoicop,
  isCurrency,
  isDti,
  kindOf,
  kindOfUnit,
  renameCarrier,
} from '../../src/model/carriers.ts';
import { exampleById } from '../../src/model/examples/index.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { canonicalJson, toKernelModel } from '../../src/model/kernel-json.ts';
import { copyFragment, pasteFragment, removeEdge } from '../../src/model/ops.ts';
import {
  addCounterFlow,
  impliedPrice,
  partnerOf,
  priceUnit,
  toggleTransaction,
  transactionOf,
} from '../../src/model/transactions.ts';
import { cloneModel } from '../../src/model/types.ts';
import { validate } from '../../src/model/validate.ts';

const purchases = () => cloneModel(exampleById('purchases')!.model);
const codes = (m: ReturnType<typeof purchases>) => validate(m).map((i) => i.code);

describe('energetic types follow the standards (FR-TYP-001, ADR 0015)', () => {
  it('reads kind from a UCUM unit, and asks when the unit cannot tell', () => {
    expect(kindOfUnit('kW.h')).toBe('energy');
    expect(kindOfUnit('MJ')).toBe('energy');
    expect(kindOfUnit('kL')).toBe('material');
    expect(kindOfUnit('kg')).toBe('material');
    expect(kindOfUnit('GBy')).toBe('information');
    expect(kindOfUnit('{subscription}')).toBeUndefined();
    expect(kindOfUnit('kg/h')).toBeUndefined();
    expect(kindOf({ id: 'x', unit: '{subscription}', _kind: 'information' })).toBe('information');
  });

  it('knows ISO 4217 currencies and the shape of an ISO 24165 DTI', () => {
    expect(isCurrency('AUD')).toBe(true);
    expect(isCurrency('XYZ')).toBe(false);
    expect(isCurrency('aud')).toBe(false);
    expect(isDti('V15WLZJMF')).toBe(true);
    expect(isDti('BTC')).toBe(false);
    expect(kindOf({ id: 'btc', _dti: 'V15WLZJMF' })).toBe('monetary');
  });

  it('treats information as not conserved unless said otherwise', () => {
    expect(conservedOf({ id: 'v', unit: 'GBy' })).toBe(false);
    expect(conservedOf({ id: 'v', unit: 'GBy', conserved: true })).toBe(true);
    expect(conservedOf({ id: 'e', unit: 'kW.h' })).toBe(true);
  });

  it('names what is wrong with a carrier', () => {
    expect(carrierProblems({ id: 'x', _currency: 'XYZ' })[0]?.text).toMatch(/ISO 4217/);
    expect(carrierProblems({ id: 'x', _currency: 'AUD', _dti: 'V15WLZJMF' })[0]?.severity).toBe(
      'error'
    );
    expect(carrierProblems({ id: 'x', unit: '{box}' })[0]?.text).toMatch(/choose a kind/);
    expect(carrierProblems({ id: 'x', unit: 'kW.h' })).toEqual([]);
  });

  it('accepts COICOP 2018 codes at any depth', () => {
    for (const c of ['04', '04.5', '04.5.1', '13.1.2.1']) expect(isCoicop(c)).toBe(true);
    for (const c of ['00', '14', '4', '04.']) expect(isCoicop(c)).toBe(false);
  });

  it('sends the kernel its carriers, and nothing new for a model without them', () => {
    const k = toKernelModel(purchases());
    expect(k.carriers).toEqual([
      { id: 'electricity', unit: 'kW.h', conserved: true },
      { id: 'video', unit: 'GBy', conserved: false },
      { id: 'aud', unit: 'AUD', conserved: true },
    ]);
    expect(k.edges.find((e) => e.id === 'power')?.coupled_edge).toBe('power_bill');
    expect('carriers' in toKernelModel(exampleById('household')!.model)).toBe(false);
  });

  it('renames a carrier everywhere it is carried, and flags an undeclared one', () => {
    const m = renameCarrier(purchases(), 'aud', 'money');
    expect(m.nodes.find((n) => n.id === 'bank')?.carrier).toBe('money');
    expect(validate(m)).toEqual([]);
    const loose = purchases();
    loose.edges.find((e) => e.id === 'pay')!.carrier = 'gold';
    expect(codes(loose)).toContain('carrier-undeclared');
  });

  it('round-trips through a file', () => {
    const m = purchases();
    expect(parseModel(serialiseModel(m)).model).toEqual(m);
  });
});

describe('transactions (FR-TRX-001)', () => {
  it('the example is complete: each transaction pairs a flow with money the other way', () => {
    const m = purchases();
    expect(validate(m)).toEqual([]);
    const t = transactionOf(
      m,
      m.edges.find((e) => e.id === 'power_bill')!
    );
    expect(t?.marked.id).toBe('power');
    expect(t?.money?.id).toBe('power_bill');
    expect(t?.goods?.id).toBe('power');
    expect(priceUnit(m, t!.money!, t!.goods!)).toBe('AUD/kW.h');
    expect(impliedPrice(96, 300)).toBeCloseTo(0.32, 12);
    expect(impliedPrice(5, 0)).toBeUndefined();
  });

  it('is invalid until its money counter-flow exists, and both flows say so', () => {
    let m = purchases();
    m = toggleTransaction(m, 'pay');
    const issues = validate(m).filter((i) => i.code === 'transaction');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.ref).toEqual({ kind: 'edge', id: 'pay' });
    expect(issues[0]?.message).toMatch(/needs a money counter-flow/);

    m = removeEdge(purchases(), 'power_bill');
    expect(m.edges.find((e) => e.id === 'power')?.coupled_edge).toBeUndefined();
    expect(codes(m)).toContain('transaction');
  });

  it('wants exactly one side to carry money', () => {
    const m = purchases();
    m.edges.find((e) => e.id === 'power_bill')!.carrier = 'electricity';
    const both = validate(m).filter((i) => i.code === 'transaction');
    expect(both.map((i) => i.ref?.id).sort()).toEqual(['power', 'power_bill']);
    expect(both[0]?.message).toMatch(/must carry money/);
  });

  it('adds a counter-flow, with new money storages and the currency if needed', () => {
    const base = cloneModel(exampleById('household')!.model);
    const marked = toggleTransaction(base, 'spend');
    const { model, id } = addCounterFlow(marked, 'spend', {
      payer: { x: 700, y: 500 },
      payee: { x: 300, y: 500 },
      carrier: 'EUR',
      k: 40,
    });
    expect(id).toBe('spend_payment');
    const pay = model.edges.find((e) => e.id === id)!;
    expect(pay).toMatchObject({ logic: 'constant', params: { k: 40 }, carrier: 'EUR' });
    expect(
      partnerOf(
        model,
        model.edges.find((e) => e.id === 'spend')!
      )?.id
    ).toBe(id);
    expect(model.carriers).toEqual([{ id: 'EUR', _label: 'EUR', _currency: 'EUR' }]);
    expect(model.nodes.filter((n) => n.carrier === 'EUR')).toHaveLength(2);
    // The household's own flows carry nothing declared yet, so only the pair is checked here.
    expect(validate(model).filter((i) => i.code === 'transaction')).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/Say what “spend” carries/) }),
      expect.objectContaining({ message: expect.stringMatching(/Say what “spend” carries/) }),
    ]);
    expect(
      addCounterFlow(marked, 'spend', { payer: 'bank', payee: 'bank', carrier: 'EUR', k: 1 }).id
    ).toBeNull();
    expect(
      addCounterFlow(marked, 'spend', { payer: 'bank', payee: 'spending', carrier: 'XYZ', k: 1 }).id
    ).toBeNull();
  });

  it('taking the transaction off unpairs the flows', () => {
    const m = toggleTransaction(purchases(), 'power');
    expect(m.edges.find((e) => e.id === 'power')?.coupled_edge).toBeUndefined();
    expect(m.edges.find((e) => e.id === 'power_bill')?.coupled_edge).toBeUndefined();
    expect(m.edges.find((e) => e.id === 'power')?.visual).toBeUndefined();
  });

  it('a pasted copy keeps its pairing only when both flows come along', () => {
    const m = purchases();
    const all = pasteFragment(m, copyFragment(m, ['grid', 'appliances', 'bank', 'retailer']), {
      x: 0,
      y: 600,
    }).model;
    const power2 = all.edges.find((e) => e.id !== 'power' && e.origin === 'grid_2')!;
    const bill2 = all.edges.find((e) => e.origin === 'bank_2' && e.target === 'retailer_2')!;
    expect(power2.coupled_edge).toBe(bill2.id);
    expect(bill2.coupled_edge).toBe(power2.id);
    const half = pasteFragment(m, copyFragment(m, ['grid', 'appliances']), { x: 0, y: 600 }).model;
    expect(half.edges.find((e) => e.origin === 'grid_2')?.coupled_edge).toBeUndefined();
  });

  it('flags a pairing to a missing flow, which the kernel accepts silently (K-10)', () => {
    const m = cloneModel(exampleById('household')!.model);
    m.edges[0]!.coupled_edge = 'ghost';
    expect(codes(m)).toContain('coupled-missing');
    expect(canonicalJson(toKernelModel(m))).toContain('"coupled_edge":"ghost"');
  });

  it('warns that the kernel exchange node moves nothing (K-9)', () => {
    const m = cloneModel(exampleById('household')!.model);
    m.nodes.push({ id: 'tx', type: 'exchange', value: 0, visual: { x: 0, y: 0 } });
    expect(codes(m)).toContain('exchange-node');
  });
});
