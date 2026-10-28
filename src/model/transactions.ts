/**
 * Transactions (FR-TRX-001): Odum's ecological-economic convention. Wherever
 * money changes hands it flows against something else (energy, a material, a
 * service, information), so a transaction is a marking on a pair of flows:
 * the flow it is placed on, and the money flow that pays for it, paired by
 * the kernel's reciprocal `coupled_edge`. Until the kernel prices the pair
 * (K-9), each flow keeps its own rate and the implied price is J_money ÷ J.
 */
import { findCarrier, isCurrency, kindOfCarrierId } from './carriers.ts';
import { uniqueId } from './ids.ts';
import {
  cloneModel,
  type Carrier,
  type ModelEdge,
  type Point,
  type StudioModel,
  type Transaction,
} from './types.ts';

export function edgeById(m: StudioModel, id: string): ModelEdge | undefined {
  return m.edges.find((e) => e.id === id);
}

/** The flow paired with this one, when the pairing is reciprocal. */
export function partnerOf(m: StudioModel, e: ModelEdge): ModelEdge | undefined {
  const p = e.coupled_edge ? edgeById(m, e.coupled_edge) : undefined;
  return p && p.coupled_edge === e.id && p.id !== e.id ? p : undefined;
}

/** The marked flow of a transaction this edge belongs to: itself, or its partner. */
export function transactionOf(
  m: StudioModel,
  e: ModelEdge
): { marked: ModelEdge; money?: ModelEdge; goods?: ModelEdge } | undefined {
  const p = partnerOf(m, e);
  const marked = e.visual?.transaction ? e : p?.visual?.transaction ? p : undefined;
  if (!marked) return undefined;
  const other = marked === e ? p : e;
  const all = other ? [marked, other] : [marked];
  const money = all.find((x) => kindOfCarrierId(m, x.carrier) === 'monetary');
  const goods = all.find((x) => x !== money && kindOfCarrierId(m, x.carrier) !== 'monetary');
  return {
    marked,
    ...(money ? { money } : {}),
    ...(goods ? { goods } : {}),
  };
}

/** Put a transaction on a flow, or take it off; taking it off unpairs the flows. */
export function toggleTransaction(m: StudioModel, edgeId: string): StudioModel {
  const e0 = edgeById(m, edgeId);
  if (!e0) return m;
  const next = cloneModel(m);
  const e = edgeById(next, edgeId)!;
  const { transaction, ...rest } = e.visual ?? {};
  if (transaction) {
    const p = partnerOf(next, e);
    if (p) delete p.coupled_edge;
    delete e.coupled_edge;
    if (Object.keys(rest).length) e.visual = rest;
    else delete e.visual;
  } else {
    e.visual = { ...rest, transaction: {} };
  }
  return next;
}

export function updateTransaction(
  m: StudioModel,
  edgeId: string,
  patch: (t: Transaction) => void
): StudioModel {
  const next = cloneModel(m);
  const t = edgeById(next, edgeId)?.visual?.transaction;
  if (!t) return m;
  patch(t);
  if (t.tags && t.tags.length === 0) delete t.tags;
  if (!t.purpose) delete t.purpose;
  return next;
}

/** A carrier the model declares, added if missing (an ISO 4217 currency by default). */
function ensureCarrier(m: StudioModel, carrier: Carrier): string {
  m.carriers ??= [];
  if (!m.carriers.some((c) => c.id === carrier.id)) m.carriers.push(carrier);
  return carrier.id;
}

export interface CounterFlowOptions {
  /** Who pays: a node id, or a point to place a new money storage. */
  payer: string | Point;
  /** Who is paid: a node id, or a point to place a new money storage. */
  payee: string | Point;
  /** The monetary carrier id; an ISO 4217 code that is not declared yet is added. */
  carrier: string;
  k: number;
}

/**
 * Draw the money flow that pays for a marked flow, and pair the two. The new
 * flow pays a constant amount per unit time, `k`, until the kernel prices it.
 */
export function addCounterFlow(
  m: StudioModel,
  edgeId: string,
  opts: CounterFlowOptions
): { model: StudioModel; id: string | null } {
  const e0 = edgeById(m, edgeId);
  if (!e0?.visual?.transaction) return { model: m, id: null };
  const next = cloneModel(m);
  const taken = new Set([
    ...next.nodes.map((n) => n.id),
    ...next.edges.map((e) => e.id),
    ...next._diagram.boundaries.map((b) => b.id),
    ...(next._diagram.groups ?? []).map((g) => g.id),
    ...(next.carriers ?? []).map((c) => c.id),
  ]);
  if (!findCarrier(next, opts.carrier)) {
    if (!isCurrency(opts.carrier)) return { model: m, id: null };
    ensureCarrier(next, { id: opts.carrier, _label: opts.carrier, _currency: opts.carrier });
  }
  const place = (end: string | Point, label: string): string => {
    if (typeof end === 'string') return end;
    const id = uniqueId(label.toLowerCase().replace(/\W+/g, '_'), taken);
    taken.add(id);
    next.nodes.push({
      id,
      type: 'storage',
      value: 0,
      carrier: opts.carrier,
      visual: { x: end.x, y: end.y, label, capacity: 100 },
    });
    return id;
  };
  const payer = place(opts.payer, 'Payer money');
  const payee = place(opts.payee, 'Payee money');
  if (payer === payee) return { model: m, id: null };
  const e = edgeById(next, edgeId)!;
  const old = partnerOf(next, e);
  if (old) delete old.coupled_edge;
  const id = uniqueId(`${e.id}_payment`, taken);
  next.edges.push({
    id,
    origin: payer,
    target: payee,
    logic: 'constant',
    params: { k: opts.k },
    carrier: opts.carrier,
    coupled_edge: e.id,
  });
  e.coupled_edge = id;
  return { model: next, id };
}

/**
 * What is wrong with a transaction, in words, for the flows it marks
 * (FR-TRX-001, FR-VAL-002): invalid until a money counter-flow exists.
 */
export function transactionProblems(m: StudioModel, marked: ModelEdge): string[] {
  const out: string[] = [];
  const p = marked.coupled_edge ? edgeById(m, marked.coupled_edge) : undefined;
  if (!marked.coupled_edge) {
    out.push(
      `the transaction on “${marked.id}” needs a money counter-flow: what is bought one way, money the other`
    );
    return out;
  }
  if (!p) {
    out.push(
      `the transaction on “${marked.id}” is paired with a missing flow “${marked.coupled_edge}”`
    );
    return out;
  }
  if (p.coupled_edge !== marked.id) out.push(`“${p.id}” does not pair back with “${marked.id}”`);
  const kinds = [marked, p].map((x) => kindOfCarrierId(m, x.carrier));
  const money = kinds.filter((k) => k === 'monetary').length;
  if (money === 0)
    out.push(
      `one of “${marked.id}” and “${p.id}” must carry money: give it a carrier with an ISO 4217 currency or an ISO 24165 token`
    );
  else if (money === 2)
    out.push(`“${marked.id}” and “${p.id}” both carry money: one must carry what is bought`);
  else if (kinds.includes(undefined))
    out.push(
      `say what “${kinds[0] === undefined ? marked.id : p.id}” carries: give it a declared carrier`
    );
  if (p.origin === marked.origin && p.target === marked.target)
    out.push(`“${p.id}” runs the same way as “${marked.id}”: money flows against what it buys`);
  return out;
}

/** The price a run implies: money J ÷ the J of what it buys, when both are known and J ≠ 0. */
export function impliedPrice(
  money: number | undefined,
  goods: number | undefined
): number | undefined {
  if (
    money === undefined ||
    goods === undefined ||
    !Number.isFinite(money) ||
    !Number.isFinite(goods)
  )
    return undefined;
  if (Math.abs(goods) < 1e-12) return undefined;
  return money / goods;
}

/** The unit a price is in, such as “AUD/kW.h”. */
export function priceUnit(m: StudioModel, money: ModelEdge, goods: ModelEdge): string {
  const mc = findCarrier(m, money.carrier);
  const gc = findCarrier(m, goods.carrier);
  const top = mc ? (mc._currency ?? mc._dti ?? mc.id) : '?';
  const bottom = gc ? (gc.unit ?? gc.id) : '?';
  return `${top}/${bottom}`;
}
