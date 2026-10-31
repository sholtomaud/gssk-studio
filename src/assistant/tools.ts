/**
 * The assistant's tools (M12, ADR 0016): thin wrappers over the app's own
 * model operations, with strict JSON Schemas a provider can call. DOM-free,
 * so they are unit-tested against the real operations.
 *
 * Tools act on a draft: the model as it was when the turn began, with this
 * turn's edits applied in order, so a later call can wire what an earlier one
 * added. Nothing reaches the person's model until they apply the turn's card.
 * Every input the assistant sets is marked (NFR-HON-002). A refused edit is
 * answered with the reason, and every edit with the checks' own messages, so
 * the model learns what is valid from the app.
 */
import { CATALOGUE, isNodeType, logicFor, PALETTE, symbolFor } from '../model/catalogue.ts';
import { addCarrier, findCarrier, isCurrency, kindOf, unitOf } from '../model/carriers.ts';
import { diagramView, findGroup, groupNodes, groupOfNode, setCollapsed } from '../model/groups.ts';
import { toKernelModel } from '../model/kernel-json.ts';
import {
  addNode,
  connect,
  findEdge,
  findNode,
  moveNode,
  removeEdge,
  removeNode,
  setControl,
  updateEdge,
  updateNode,
} from '../model/ops.ts';
import { inputKey, markInputs, marksFor, type InputField } from '../model/provenance.ts';
import {
  addCounterFlow,
  toggleTransaction,
  transactionOf,
  updateTransaction,
} from '../model/transactions.ts';
import {
  EDGE_LOGICS,
  type EdgeLogic,
  type ModelNode,
  type Point,
  type Provenance,
  type StudioModel,
} from '../model/types.ts';
import { validate } from '../model/validate.ts';

/** A tool as offered to a provider: name, what it does, and a strict JSON Schema for its arguments. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

/** What a run tool reports: the kernel's numbers, with the run's identity (NFR-HON-001). */
export interface RunSummary {
  /** The first 12 hex digits of the model hash: the run's identity in the manifest. */
  runId: string;
  steps: number;
  method: string;
  assumedInputs: number;
  solverConfident: boolean;
  /** Each node's level at the end of the run. */
  final: Record<string, number>;
}

/** A turn's working state. */
export interface ToolContext {
  /** The draft the turn's edits build up, starting from the person's model. */
  draft: StudioModel;
  /** One line per edit, for the card the person applies or discards. */
  steps: string[];
  /** Who is setting values, for their marks. */
  author: Pick<Provenance, 'provider' | 'model'>;
  /** Run a model on the kernel (the app's worker); absent in contexts that cannot run. */
  run?: (m: StudioModel) => Promise<RunSummary>;
  /** The last run in this conversation, if any. */
  lastRun?: RunSummary;
  now?: () => string;
}

export interface ToolResult {
  ok: boolean;
  /** Sent back to the provider as the tool's answer (JSON). */
  result: unknown;
}

// ---- schemas ---------------------------------------------------------------

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const optNum = (description: string) => ({ type: ['number', 'null'], description });
const optStr = (description: string) => ({ type: ['string', 'null'], description });
const oneOf = (values: readonly string[], description: string) => ({
  type: 'string',
  enum: [...values],
  description,
});

/** Strict: every property listed and required; optional ones take null. */
function schema(properties: Record<string, unknown>): JsonSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const WHY = optStr(
  'Why you chose any number you set here, in a few words. Every number you set is shown to the person as your assumption, not data.'
);

export const TOOLS: readonly ToolSpec[] = [
  {
    name: 'describe_model',
    description:
      'The model as it stands in this turn: its symbols, flows, carriers and groups, the symbol types you can add and the flow logics with what each needs.',
    parameters: schema({}),
  },
  {
    name: 'get_checks',
    description: 'The app’s checks on the model: errors that stop a run, warnings and notes.',
    parameters: schema({}),
  },
  {
    name: 'get_kernel_json',
    description:
      'The exact JSON the GSSK kernel would be given for a run: no layout, no groups. Use it to check wiring.',
    parameters: schema({}),
  },
  {
    name: 'add_symbol',
    description:
      'Add an Odum symbol. Its id is made from the label. Leave x and y null to place it clear of the others.',
    parameters: schema({
      type: oneOf(
        PALETTE.map((s) => s.type),
        'The symbol type'
      ),
      label: str('A short name, such as “Water tank”'),
      x: optNum('Canvas x, or null'),
      y: optNum('Canvas y, or null'),
      value: optNum('Initial level, supply or value; null keeps the default'),
      capacity: optNum('For a storage: the level its gauge reads as full; null keeps the default'),
      carrier: optStr('A declared carrier id (see add_carrier), or null'),
      why: WHY,
    }),
  },
  {
    name: 'connect',
    description:
      'Add a flow from one symbol to another. A second flow between the same two symbols is a separate pathway.',
    parameters: schema({
      from: str('The origin symbol id'),
      to: str('The target symbol id'),
      logic: {
        type: ['string', 'null'],
        enum: [...EDGE_LOGICS, null],
        description: 'The flow logic; null for linear (J = k·Q of the origin)',
      },
      k: optNum('The rate k; null keeps the default 0.1'),
      carrier: optStr('A declared carrier id, or null'),
      why: WHY,
    }),
  },
  {
    name: 'set_control',
    description:
      'Make a symbol the control of a flow (Odum’s work gate): the flow becomes an interaction, J = k·Q₀·Qc.',
    parameters: schema({ flow: str('The flow id'), control: str('The controlling symbol id') }),
  },
  {
    name: 'set_values',
    description:
      'Set a symbol’s or flow’s numbers. Each one you set is shown as your assumption until the person or calibration replaces it.',
    parameters: schema({
      kind: oneOf(['node', 'edge'], 'A symbol (node) or a flow (edge)'),
      id: str('Its id'),
      value: optNum('A symbol’s initial value, or null'),
      capacity: optNum('A storage’s full-gauge level, or null'),
      k: optNum('A flow’s or symbol’s rate k, or null'),
      threshold: optNum('A flow’s threshold, or null'),
      why: str('Why these numbers, in a few words'),
    }),
  },
  {
    name: 'add_carrier',
    description:
      'Declare what flows: money by its ISO 4217 currency, or a physical thing by its UCUM unit (kW.h, kL, kg, GBy).',
    parameters: schema({
      id: str('A short id, such as “water” or “aud”'),
      label: str('Its name'),
      unit: optStr('A UCUM unit for a physical carrier, or null'),
      currency: optStr('An ISO 4217 code for money, or null'),
    }),
  },
  {
    name: 'set_carrier',
    description: 'Say what a symbol holds or a flow carries, by a declared carrier id.',
    parameters: schema({
      kind: oneOf(['node', 'edge'], 'A symbol (node) or a flow (edge)'),
      id: str('Its id'),
      carrier: str('A declared carrier id'),
    }),
  },
  {
    name: 'move',
    description: 'Move a symbol on the canvas.',
    parameters: schema({ id: str('The symbol id'), x: num('Canvas x'), y: num('Canvas y') }),
  },
  {
    name: 'remove',
    description: 'Remove a symbol (and its flows) or a flow.',
    parameters: schema({ kind: oneOf(['node', 'edge'], 'What to remove'), id: str('Its id') }),
  },
  {
    name: 'group',
    description:
      'Pack symbols into one group (a zoom group: drawn as one symbol, run as all of them).',
    parameters: schema({
      ids: { type: 'array', items: { type: 'string' }, description: 'The symbol ids' },
      label: str('The group’s name'),
      packed: { type: 'boolean', description: 'Draw it packed (true) or as a frame (false)' },
    }),
  },
  {
    name: 'add_loss',
    description:
      'Odum’s depreciation pathway: drain a storage to a heat sink with a linear flow, J = k·Q. Every storage loses something as it stores (leaks, evaporation, wear, decay). Adds a heat sink below it unless you name one.',
    parameters: schema({
      from: str('The storage that loses'),
      sink: optStr('An existing heat sink id to drain into, or null to add one below the storage'),
      k: optNum('The loss rate k per unit time (a fraction of the store); null for 0.01'),
      why: WHY,
    }),
  },
  {
    name: 'pack',
    description: 'Pack a group into one symbol, or unpack it to show what it holds. Layout only.',
    parameters: schema({
      group: str('The group id'),
      packed: { type: 'boolean', description: 'true to pack, false to unpack' },
    }),
  },
  {
    name: 'add_transaction',
    description:
      'Mark a flow as bought: Odum’s transaction. It is invalid until a money counter-flow runs the other way (add_counter_flow).',
    parameters: schema({
      flow: str('The flow of what is bought'),
      purpose: optStr(
        'A COICOP 2018 code for the household purpose (04 housing, water, electricity…), or null'
      ),
    }),
  },
  {
    name: 'add_counter_flow',
    description:
      'Draw the money flow that pays for a marked flow, from the payer to the payee, at k money per unit time. Null payer or payee places a new money storage.',
    parameters: schema({
      flow: str('The marked flow'),
      payer: optStr(
        'The symbol that pays (on the receiving side), or null for a new money storage'
      ),
      payee: optStr('The symbol paid (on the supplying side), or null for a new money storage'),
      currency: str('A declared monetary carrier id, or an ISO 4217 code'),
      k: num('Money per unit time'),
      why: str('Why this amount'),
    }),
  },
  {
    name: 'run_model',
    description:
      'Run the model as it stands in this turn on the GSSK kernel. Returns the run id and each symbol’s final level: the only numbers you may report as results.',
    parameters: schema({}),
  },
  {
    name: 'get_run_summary',
    description: 'The last run in this conversation: its id and final levels.',
    parameters: schema({}),
  },
];

// ---- running a tool ----------------------------------------------------------

type Args = Record<string, unknown>;

const s = (a: Args, k: string): string | undefined =>
  typeof a[k] === 'string' ? (a[k] as string) : undefined;
const n = (a: Args, k: string): number | undefined =>
  typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : undefined;

class Refused extends Error {}

function refuse(message: string): never {
  throw new Refused(message);
}

const labelOf = (m: StudioModel, id: string) => findNode(m, id)?.visual.label ?? id;

/** A free spot on a 180 × 160 grid, right of and level with what is there. */
function freeSpot(m: StudioModel): Point {
  const taken = (p: Point) =>
    m.nodes.some((x) => Math.hypot(x.visual.x - p.x, x.visual.y - p.y) < 140);
  for (let row = 0; row < 40; row++) {
    for (let col = 0; col < 8; col++) {
      const p = { x: 120 + col * 180, y: 140 + row * 160 };
      if (!taken(p)) return p;
    }
  }
  return { x: 120, y: 140 };
}

/** The checks a reply should see after an edit: errors and warnings, briefly. */
function checksOf(m: StudioModel): { errors: string[]; warnings: string[] } {
  const issues = validate(m);
  return {
    errors: issues
      .filter((i) => i.severity === 'error')
      .map((i) => i.message)
      .slice(0, 8),
    warnings: issues
      .filter((i) => i.severity === 'warning')
      .map((i) => i.message)
      .slice(0, 8),
  };
}

function describe(m: StudioModel): unknown {
  const view = diagramView(m);
  return {
    name: m.metadata.name,
    config: m.config,
    symbols: m.nodes.map((x) => ({
      id: x.id,
      type: x.type,
      label: x.visual.label ?? x.id,
      value: x.value,
      ...(x.visual.capacity !== undefined ? { capacity: x.visual.capacity } : {}),
      ...(x.carrier ? { carrier: x.carrier } : {}),
      ...(x.params && Object.keys(x.params).length ? { params: x.params } : {}),
      at: [x.visual.x, x.visual.y],
      ...(groupOfNode(m, x.id) ? { group: groupOfNode(m, x.id)!.id } : {}),
      ...(view.nodes.has(x.id) ? {} : { hiddenInPackedGroup: true }),
      ...(marksFor(m, 'node', x.id).some((k) => k.mark.by === 'assistant')
        ? {
            assumed: marksFor(m, 'node', x.id)
              .filter((k) => k.mark.by === 'assistant')
              .map((k) => k.field),
          }
        : {}),
    })),
    flows: m.edges.map((e) => {
      const trx = transactionOf(m, e);
      const assumed = marksFor(m, 'edge', e.id).filter((k) => k.mark.by === 'assistant');
      return {
        id: e.id,
        from: e.origin,
        to: e.target,
        logic: e.logic,
        params: e.params,
        ...(e.carrier ? { carrier: e.carrier } : {}),
        ...(trx ? { transaction: trx.marked === e ? 'marked' : `pays for ${trx.marked.id}` } : {}),
        ...(e.coupled_edge ? { coupledWith: e.coupled_edge } : {}),
        ...(assumed.length ? { assumed: assumed.map((k) => k.field) } : {}),
      };
    }),
    carriers: (m.carriers ?? []).map((c) => ({
      id: c.id,
      label: c._label ?? c.id,
      kind: kindOf(c) ?? 'unknown',
      ...(unitOf(c) ? { unit: unitOf(c) } : {}),
    })),
    groups: (m._diagram.groups ?? []).map((g) => ({
      id: g.id,
      label: g.label,
      symbols: g.nodes,
      packed: g.collapsed,
      ...(g.parent ? { inside: g.parent } : {}),
    })),
    symbolTypes: PALETTE.map((x) => ({ type: x.type, name: x.label, what: x.summary })),
    logics: EDGE_LOGICS.map((l) => {
      const spec = logicFor(l);
      return { logic: l, formula: spec.formula, needs: spec.needs };
    }),
  };
}

/**
 * Run one tool call against the turn's draft. Edits replace `ctx.draft` and
 * add a line to `ctx.steps`; a refused edit changes nothing and says why.
 */
export async function callTool(ctx: ToolContext, name: string, args: Args): Promise<ToolResult> {
  try {
    const result = await dispatch(ctx, name, args ?? {});
    return { ok: true, result };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, result: { error: err.message } };
    throw err;
  }
}

async function dispatch(ctx: ToolContext, name: string, a: Args): Promise<unknown> {
  const m = ctx.draft;
  const at = ctx.now?.() ?? new Date().toISOString();
  /** Mark the inputs set in `next`, with this call's reason, and make it the draft. */
  const commit = (next: StudioModel, step: string, marked: string[] = [], why?: string) => {
    if (next === m) refuse('That changed nothing.');
    markInputs(next, marked, {
      by: 'assistant',
      at,
      ...ctx.author,
      ...(why ? { why } : {}),
    });
    ctx.draft = next;
    ctx.steps.push(step);
  };
  const node = (id: string | undefined): ModelNode => {
    const x = id ? findNode(m, id) : undefined;
    if (!x) refuse(`There is no symbol “${id ?? ''}”. describe_model lists them.`);
    return x;
  };
  const carrierOk = (id: string | undefined) => {
    if (id && !findCarrier(m, id))
      refuse(`There is no carrier “${id}”. Declare it first with add_carrier.`);
  };

  switch (name) {
    case 'describe_model':
      return describe(m);
    case 'get_checks':
      return validate(m).map((i) => ({
        severity: i.severity,
        message: i.message,
        ...(i.ref ? { on: i.ref.id } : {}),
      }));
    case 'get_kernel_json':
      return toKernelModel(m);

    case 'add_symbol': {
      const type = s(a, 'type');
      if (!type || !isNodeType(type) || !symbolFor(type).palette)
        refuse(
          `“${type ?? ''}” is not a symbol type you can add. Use one of: ${PALETTE.map((x) => x.type).join(', ')}.`
        );
      const label = s(a, 'label')?.trim() || symbolFor(type).label;
      carrierOk(s(a, 'carrier'));
      const x = n(a, 'x');
      const y = n(a, 'y');
      const spot = x !== undefined && y !== undefined ? { x, y } : freeSpot(m);
      const { model, id } = addNode(m, type, spot, label);
      const added = findNode(model, id)!;
      const marked: string[] = [];
      const value = n(a, 'value');
      if (value !== undefined) {
        added.value = value;
        marked.push(inputKey('node', id, 'value'));
      }
      const capacity = n(a, 'capacity');
      if (capacity !== undefined && symbolFor(type).holdsState) {
        added.visual.capacity = capacity;
        marked.push(inputKey('node', id, 'capacity'));
      }
      const carrier = s(a, 'carrier');
      if (carrier) added.carrier = carrier;
      commit(model, `Add ${symbolFor(type).label.toLowerCase()} “${label}”`, marked, s(a, 'why'));
      return { id, at: [spot.x, spot.y], checks: checksOf(ctx.draft) };
    }

    case 'connect': {
      const from = node(s(a, 'from')).id;
      const to = node(s(a, 'to')).id;
      if (from === to) refuse('A flow cannot run from a symbol to itself.');
      const logic = s(a, 'logic') as EdgeLogic | undefined;
      if (logic && !EDGE_LOGICS.includes(logic)) refuse(`“${logic}” is not a flow logic.`);
      carrierOk(s(a, 'carrier'));
      const { model, id } = connect(m, from, to);
      if (!id) refuse(`Could not connect “${from}” to “${to}”.`);
      const e = findEdge(model, id)!;
      if (logic) e.logic = logic;
      const marked: string[] = [];
      const k = n(a, 'k');
      if (k !== undefined) {
        e.params.k = k;
        marked.push(inputKey('edge', id, 'params.k'));
      }
      const carrier = s(a, 'carrier');
      if (carrier) e.carrier = carrier;
      commit(model, `Connect “${labelOf(m, from)}” → “${labelOf(m, to)}”`, marked, s(a, 'why'));
      return { id, checks: checksOf(ctx.draft) };
    }

    case 'set_control': {
      const flow = s(a, 'flow');
      if (!flow || !findEdge(m, flow)) refuse(`There is no flow “${flow ?? ''}”.`);
      const control = node(s(a, 'control')).id;
      commit(setControl(m, flow, control), `“${labelOf(m, control)}” controls ${flow}`);
      return { flow, checks: checksOf(ctx.draft) };
    }

    case 'set_values': {
      const kind = s(a, 'kind') === 'edge' ? 'edge' : 'node';
      const id = s(a, 'id') ?? '';
      const fields: [InputField, number][] = [];
      for (const [key, field] of [
        ['value', 'value'],
        ['capacity', 'capacity'],
        ['k', 'params.k'],
        ['threshold', 'params.threshold'],
      ] as const) {
        const v = n(a, key);
        if (v !== undefined) fields.push([field, v]);
      }
      if (fields.length === 0) refuse('Give at least one number to set.');
      let next: StudioModel;
      if (kind === 'node') {
        node(id);
        if (fields.some(([f]) => f === 'params.threshold'))
          refuse('A symbol has no threshold; a flow does.');
        next = updateNode(m, id, (x) => {
          for (const [f, v] of fields) {
            if (f === 'value') x.value = v;
            else if (f === 'capacity') x.visual.capacity = v;
            else x.params = { ...x.params, k: v };
          }
        });
      } else {
        if (!findEdge(m, id)) refuse(`There is no flow “${id}”.`);
        if (fields.some(([f]) => f === 'value' || f === 'capacity'))
          refuse('A flow has a rate k and maybe a threshold, not a value or capacity.');
        next = updateEdge(m, id, (e) => {
          for (const [f, v] of fields) {
            if (f === 'params.k') e.params.k = v;
            else e.params.threshold = v;
          }
        });
      }
      commit(
        next,
        `Set ${fields.map(([f, v]) => `${f.replace('params.', '')} = ${v}`).join(', ')} on ${kind === 'node' ? `“${labelOf(m, id)}”` : id}`,
        fields.map(([f]) => inputKey(kind, id, f)),
        s(a, 'why')
      );
      return {
        id,
        set: Object.fromEntries(fields.map(([f, v]) => [f, v])),
        checks: checksOf(ctx.draft),
      };
    }

    case 'add_carrier': {
      const id = s(a, 'id');
      const label = s(a, 'label') ?? id;
      const unit = s(a, 'unit');
      const currency = s(a, 'currency')?.toUpperCase();
      if (!id) refuse('Give the carrier an id.');
      if (findCarrier(m, id)) return { id, note: 'Already declared.' };
      if (currency && !isCurrency(currency))
        refuse(`“${currency}” is not an ISO 4217 currency code.`);
      if (!unit && !currency)
        refuse('Give a UCUM unit for a physical carrier, or an ISO 4217 currency for money.');
      const { model, id: added } = addCarrier(m, {
        id,
        _label: label ?? id,
        ...(currency ? { _currency: currency } : { unit }),
      });
      commit(
        model,
        `Declare carrier “${label}”${currency ? ` (${currency})` : unit ? ` (${unit})` : ''}`
      );
      return { id: added };
    }

    case 'set_carrier': {
      const kind = s(a, 'kind') === 'edge' ? 'edge' : 'node';
      const id = s(a, 'id') ?? '';
      const carrier = s(a, 'carrier');
      carrierOk(carrier);
      if (!carrier) refuse('Name a carrier.');
      const next =
        kind === 'node'
          ? (node(id), updateNode(m, id, (x) => (x.carrier = carrier)))
          : findEdge(m, id)
            ? updateEdge(m, id, (e) => (e.carrier = carrier))
            : refuse(`There is no flow “${id}”.`);
      commit(next, `${kind === 'node' ? `“${labelOf(m, id)}”` : id} carries ${carrier}`);
      return { id, checks: checksOf(ctx.draft) };
    }

    case 'move': {
      const id = node(s(a, 'id')).id;
      const x = n(a, 'x');
      const y = n(a, 'y');
      if (x === undefined || y === undefined) refuse('Give x and y.');
      commit(moveNode(m, id, { x, y }), `Move “${labelOf(m, id)}”`);
      return { id };
    }

    case 'remove': {
      const id = s(a, 'id') ?? '';
      if (s(a, 'kind') === 'edge') {
        if (!findEdge(m, id)) refuse(`There is no flow “${id}”.`);
        commit(removeEdge(m, id), `Remove flow ${id}`);
      } else {
        const label = labelOf(m, node(id).id);
        commit(removeNode(m, id), `Remove “${label}” and its flows`);
      }
      return { removed: id, checks: checksOf(ctx.draft) };
    }

    case 'group': {
      const ids = Array.isArray(a.ids)
        ? a.ids.filter((x): x is string => typeof x === 'string')
        : [];
      for (const id of ids) node(id);
      const label = s(a, 'label') ?? 'Group';
      const { model, id } = groupNodes(m, ids, label, a.packed !== false);
      if (!id) refuse('Name at least one symbol to group.');
      commit(model, `Group ${ids.length} symbols as “${label}”`);
      return { id };
    }

    case 'add_loss': {
      const from = node(s(a, 'from'));
      if (!symbolFor(from.type).holdsState || from.type === 'sink')
        refuse(`“${from.id}” holds nothing to lose: add_loss is for storages.`);
      const sinkId = s(a, 'sink');
      if (sinkId && node(sinkId).type !== 'sink') refuse(`“${sinkId}” is not a heat sink.`);
      let model = m;
      let sink = sinkId;
      if (!sink) {
        const added = addNode(
          m,
          'sink',
          { x: from.visual.x, y: from.visual.y + 150 },
          `${from.visual.label ?? from.id} loss`
        );
        model = added.model;
        sink = added.id;
      }
      const joined = connect(model, from.id, sink);
      if (!joined.id) refuse(`Could not connect “${from.id}” to “${sink}”.`);
      const e = findEdge(joined.model, joined.id)!;
      e.logic = 'linear';
      if (from.carrier) {
        e.carrier = from.carrier;
        const h = findNode(joined.model, sink)!;
        h.carrier ??= from.carrier;
      }
      const k = n(a, 'k');
      e.params.k = k ?? 0.01;
      commit(
        joined.model,
        `Add loss: “${labelOf(m, from.id)}” → heat sink (k = ${e.params.k})`,
        k !== undefined ? [inputKey('edge', joined.id, 'params.k')] : [],
        s(a, 'why')
      );
      return { flow: joined.id, sink, k: e.params.k, checks: checksOf(ctx.draft) };
    }

    case 'pack': {
      const id = s(a, 'group') ?? '';
      const g = findGroup(m, id);
      if (!g) refuse(`There is no group “${id}”.`);
      const packed = a.packed !== false;
      commit(setCollapsed(m, id, packed), `${packed ? 'Pack' : 'Unpack'} “${g.label}”`);
      return { id, packed };
    }

    case 'add_transaction': {
      const flow = s(a, 'flow') ?? '';
      const e = findEdge(m, flow);
      if (!e) refuse(`There is no flow “${flow}”.`);
      if (transactionOf(m, e)) refuse('That flow is already part of a transaction.');
      let next = toggleTransaction(m, flow);
      const purpose = s(a, 'purpose');
      if (purpose) next = updateTransaction(next, flow, (t) => (t.purpose = purpose));
      commit(next, `Transaction on ${flow}`);
      return { flow, checks: checksOf(ctx.draft) };
    }

    case 'add_counter_flow': {
      const flow = s(a, 'flow') ?? '';
      const e = findEdge(m, flow);
      if (!e?.visual?.transaction)
        refuse(`“${flow}” has no transaction on it: add_transaction first.`);
      const k = n(a, 'k');
      if (k === undefined) refuse('Give the amount per unit time, k.');
      const near = (id: string, dy: number): Point => {
        const x = findNode(m, id)!;
        return { x: x.visual.x, y: x.visual.y + dy };
      };
      const payer = s(a, 'payer');
      const payee = s(a, 'payee');
      if (payer) node(payer);
      if (payee) node(payee);
      const currency = s(a, 'currency') ?? '';
      const { model, id } = addCounterFlow(m, flow, {
        payer: payer ?? near(e.target, 160),
        payee: payee ?? near(e.origin, 160),
        carrier: currency,
        k,
      });
      if (!id)
        refuse('Choose two different ends, and a declared monetary carrier or an ISO 4217 code.');
      commit(
        model,
        `Money counter-flow ${id} pays for ${flow}`,
        [inputKey('edge', id, 'params.k')],
        s(a, 'why')
      );
      return { id, checks: checksOf(ctx.draft) };
    }

    case 'run_model': {
      if (!ctx.run) refuse('Running is not available here.');
      const checks = checksOf(m);
      if (checks.errors.length) refuse(`Fix these first: ${checks.errors.join(' · ')}`);
      ctx.lastRun = await ctx.run(m);
      return ctx.lastRun;
    }

    case 'get_run_summary':
      return ctx.lastRun ?? { note: 'No run yet in this conversation: use run_model.' };

    default:
      refuse(`There is no tool “${name}”.`);
  }
}

/** A short line naming a node by its type, for the catalogue in the system prompt. */
export function symbolCatalogue(): string {
  return CATALOGUE.filter((x) => x.palette)
    .map((x) => `- ${x.type} (${x.label}): ${x.summary}`)
    .join('\n');
}

/**
 * The model in a few lines, sent with each message so a reply is about this
 * model (ADR 0016): its symbols and flows by id, and the storages with no
 * loss to a heat sink. Long models are cut short; describe_model has it all.
 */
export function modelBrief(m: StudioModel, limit = 40): string {
  if (m.nodes.length === 0) return 'The model is empty.';
  const sym = m.nodes
    .slice(0, limit)
    .map(
      (x) =>
        `${x.id} (${x.type}${x.visual.label && x.visual.label !== x.id ? ` “${x.visual.label}”` : ''}${x.carrier ? `, ${x.carrier}` : ''})`
    );
  const flows = m.edges
    .slice(0, limit)
    .map((e) => `${e.id}: ${e.origin}→${e.target} ${e.logic} k=${e.params.k}`);
  const sinks = new Set(m.nodes.filter((x) => x.type === 'sink').map((x) => x.id));
  const lossless = m.nodes
    .filter(
      (x) => symbolFor(x.type).holdsState && x.type !== 'sink' && !symbolFor(x.type).composite
    )
    .filter((x) => !m.edges.some((e) => e.origin === x.id && sinks.has(e.target)))
    .map((x) => x.id);
  const more = (all: unknown[]) =>
    all.length > limit ? `; and ${all.length - limit} more (describe_model)` : '';
  return [
    `Symbols: ${sym.join(', ')}${more(m.nodes)}.`,
    `Flows: ${flows.length ? flows.join('; ') : 'none'}${more(m.edges)}.`,
    ...(lossless.length ? [`Storages with no loss to a heat sink: ${lossless.join(', ')}.`] : []),
  ].join('\n');
}
