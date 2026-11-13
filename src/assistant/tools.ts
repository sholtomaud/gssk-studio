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
import {
  addCarrier,
  findCarrier,
  isCurrency,
  kindOf,
  kindOfCarrierId,
  unitOf,
} from '../model/carriers.ts';
import { REFERENCE, referenceEntry, SOURCES } from './odum.ts';
import {
  addControl,
  createProcess,
  describeProcess,
  findProcess,
  flowToProcess,
  pathways,
  processesOf,
  processGaps,
  processOfEdge,
  removeProcess,
} from '../model/processes.ts';
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
  updateEdge,
  updateNode,
} from '../model/ops.ts';
import {
  compareInputs,
  inputKey,
  markInputs,
  marksFor,
  type InputField,
} from '../model/provenance.ts';
import type { CalibrationResult } from '../fit/calibrate.ts';
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
  /** Calibrate rates to the model's observations on the kernel (the app's worker, ADR 0008). */
  calibrate?: (
    m: StudioModel,
    edgeIds: string[],
    maxIterations: number
  ) => Promise<CalibrationResult>;
  /** Check and run an Energese script in the script sandbox (ADR 0013), building on `previous`. */
  runEnergese?: (source: string, previous: StudioModel) => Promise<EnergeseOutcome>;
  now?: () => string;
}

/** What running an Energese script gave: the model it builds, or why it did not build. */
export type EnergeseOutcome =
  | { ok: true; model: StudioModel; logs: string[] }
  | { ok: false; problems: string[]; logs: string[] };

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
    name: 'odum_reference',
    description:
      'Read the app’s reference on Odum’s energy systems language: a symbol (what it means, how to draw it here, common mistakes) or a convention (losses, money, materials, layout, flow logics, how to build a model). Read it before explaining a symbol or convention, or when unsure how to draw something; quote it rather than guess. "index" lists every entry.',
    parameters: schema({
      topic: oneOf(['index', ...REFERENCE.map((e) => e.id)], 'An entry id, or index'),
    }),
  },
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
      'Make a symbol the control of a flow: the flow becomes the product of an interaction process, J = k·Q₀·Qc, with a used-energy pathway to a heat sink. The control is only read; use add_interaction for an ingredient that is used up.',
    parameters: schema({ flow: str('The flow id'), control: str('The controlling symbol id') }),
  },
  {
    name: 'add_interaction',
    description:
      'Odum’s interaction (work gate) as a production process: the main input (most energy, from the left) and the controls (from the right) combine by the production function into a product, with the used energy to a heat sink. Every pathway is a flow with its own k. A control that is an ingredient is used up (drawn down in proportion); a force or information is only read. A unit feeding back to its own intake is a control that is also the product.',
    parameters: schema({
      input: str('The main input'),
      controls: {
        type: 'array',
        description: 'The other inputs, each used up or only read',
        items: {
          type: 'object',
          properties: {
            node: str('A symbol id'),
            used: {
              type: 'boolean',
              description: 'Drawn down in proportion (an ingredient), or only read',
            },
          },
          required: ['node', 'used'],
          additionalProperties: false,
        },
      },
      product: str('What it makes: the target of the product pathway'),
      op: oneOf(
        ['product', 'divide', 'subtract'],
        'product k·A·B…; divide k·A/B (dilution); subtract k·(A − B)'
      ),
      k: optNum('The product pathway’s k, or null for 0.1'),
      heat_k: optNum('The used-energy pathway’s k, or null for 0.01'),
      label: optStr('A name for the process, or null'),
      why: WHY,
    }),
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
    name: 'calibrate',
    description:
      'Fit flow rates k to the observation series the model is compared with, by least squares on the GSSK kernel (the app’s own calibration). The fitted rates are marked as calibrated, not as your assumption. Needs observations (the person adds them); returns each rate before and after, its standard error, and the fit before and after: the only fit figures you may report.',
    parameters: schema({
      flows: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ids of the flows whose rates to fit; fewer fit faster and more reliably',
      },
      max_iterations: optNum('At most this many iterations (default 40, at most 500)'),
    }),
  },
  {
    name: 'propose_energese',
    description:
      "Build the model from an Energese TypeScript script instead of tool by tool: `import * as ener from 'energese';`, build `const m = new ener.Model(…)`, then `export default m;`. get_kernel_json and the code view show the form. The app type-checks it and runs it in a sandbox with no network; what it builds replaces the draft, keeping positions of symbols it keeps. Every number it sets differently is marked as your assumption.",
    parameters: schema({
      source: str('The whole script'),
      why: WHY,
    }),
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
    interactions: processesOf(m).map((p) => ({
      id: p.id,
      reads: describeProcess(m, p),
      op: p.op,
      ...(p.input ? { input: p.input } : {}),
      controls: p.controls,
      ...(p.target ? { product: p.target } : {}),
      ...(p.sink ? { heatSink: p.sink } : {}),
      ...(processGaps(p).length ? { needs: processGaps(p) } : {}),
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
    case 'odum_reference': {
      const topic = s(a, 'topic') ?? 'index';
      if (topic === 'index')
        return {
          entries: REFERENCE.map((e) => ({ id: e.id, title: e.title, gist: e.gist })),
          sources: SOURCES,
        };
      const e = referenceEntry(topic);
      if (!e) refuse(`There is no reference entry “${topic}”. Use “index” to list them.`);
      return { id: e.id, title: e.title, text: e.text, see: e.see };
    }

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
      const e = flow ? findEdge(m, flow) : undefined;
      if (!flow || !e) refuse(`There is no flow “${flow ?? ''}”.`);
      const control = node(s(a, 'control')).id;
      const pr = processOfEdge(m, e);
      if (pr) {
        commit(addControl(m, pr.id, control), `“${labelOf(m, control)}” also controls ${flow}`);
        return { process: pr.id, checks: checksOf(ctx.draft) };
      }
      const from = findNode(m, e.origin)!.visual;
      const to = findNode(m, e.target)!.visual;
      const { model, id } = flowToProcess(m, flow, control, {
        x: Math.round((from.x + to.x) / 20) * 10,
        y: Math.round((from.y + to.y) / 20) * 10,
      });
      if (!id) refuse(`“${control}” cannot control “${flow}”: it is the flow's own origin.`);
      commit(model, `“${labelOf(m, control)}” controls ${flow}`);
      return { process: id, checks: checksOf(ctx.draft) };
    }

    case 'add_interaction': {
      const input = node(s(a, 'input')).id;
      const product = node(s(a, 'product')).id;
      const rawControls = Array.isArray(a.controls) ? a.controls : [];
      const controls = rawControls
        .filter(
          (c): c is { node: string; used?: boolean } =>
            !!c && typeof (c as { node?: unknown }).node === 'string'
        )
        .map((c) => ({ node: node(c.node).id, used: c.used === true }));
      if (controls.length === 0)
        refuse('An interaction needs at least one control: what the main input combines with.');
      const op =
        s(a, 'op') === 'divide' || s(a, 'op') === 'subtract'
          ? (s(a, 'op') as 'divide' | 'subtract')
          : 'product';
      if (op !== 'product' && controls.length > 1)
        refuse('A divisor or subtraction takes one control.');
      const at = (id: string) => findNode(m, id)!.visual;
      const label = s(a, 'label');
      const { model, id } = createProcess(
        m,
        {
          x: Math.round((at(input).x + at(product).x) / 20) * 10,
          y: Math.round((at(input).y + at(product).y) / 20) * 10,
        },
        { op, input, target: product, controls, ...(label ? { label } : {}) }
      );
      const ways = pathways(model, id);
      const marked: string[] = [];
      const k = n(a, 'k');
      const heatK = n(a, 'heat_k');
      if (k !== undefined && ways.product) {
        ways.product.params.k = k;
        marked.push(inputKey('edge', ways.product.id, 'params.k'));
      }
      if (heatK !== undefined && ways.heat) {
        ways.heat.params.k = heatK;
        marked.push(inputKey('edge', ways.heat.id, 'params.k'));
      }
      commit(
        model,
        `Add interaction: ${describeProcess(model, findProcess(model, id)!)}`,
        marked,
        s(a, 'why')
      );
      return {
        process: id,
        pathways: {
          product: ways.product?.id,
          heat: ways.heat?.id,
          uses: [...ways.uses.values()].map((e) => e.id),
        },
        checks: checksOf(ctx.draft),
      };
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
        const e = findEdge(m, id);
        if (!e) refuse(`There is no flow “${id}”.`);
        const pr = processOfEdge(m, e);
        // A pathway goes with its process: removing one removes the interaction.
        if (pr) commit(removeProcess(m, pr.id), `Remove interaction ${describeProcess(m, pr)}`);
        else commit(removeEdge(m, id), `Remove flow ${id}`);
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
      if (kindOfCarrierId(m, from.carrier) === 'monetary')
        refuse(
          `“${from.id}” holds money. In Odum’s diagrams money does not go to a heat sink: it circulates, flowing against what it buys. Draw spending as a flow to whoever is paid (see odum_reference “money”).`
        );
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

    case 'calibrate': {
      const ids = Array.isArray(a.flows)
        ? [...new Set(a.flows.filter((x): x is string => typeof x === 'string'))]
        : [];
      if (ids.length === 0) refuse('Name at least one flow whose rate to fit.');
      for (const id of ids) if (!findEdge(m, id)) refuse(`There is no flow “${id}”.`);
      if (!ctx.calibrate) refuse('Calibrating is not available here.');
      const checks = checksOf(m);
      if (checks.errors.length) refuse(`Fix these first: ${checks.errors.join(' · ')}`);
      const iterations = Math.round(Math.max(1, Math.min(500, n(a, 'max_iterations') ?? 40)));
      let r: CalibrationResult;
      try {
        r = await ctx.calibrate(m, ids, iterations);
      } catch (err) {
        refuse(err instanceof Error ? err.message : String(err));
      }
      let next = m;
      for (const rate of r.rates)
        if (Number.isFinite(rate.after))
          next = updateEdge(next, rate.edgeId, (e) => (e.params.k = rate.after));
      const names = [...new Set(r.fits.map((f) => f.name))].join(', ');
      if (next !== m) {
        // Fitted to data, so not the assistant's assumption (NFR-HON-002).
        markInputs(
          next,
          r.rates.map((x) => inputKey('edge', x.edgeId, 'params.k')),
          { by: 'calibration', at, why: `Fitted to ${names} (calibrate, ${r.stop})` }
        );
        ctx.draft = next;
        ctx.steps.push(`Calibrate ${ids.join(', ')} to ${names}`);
      }
      return {
        rates: r.rates.map((x) => ({
          flow: x.edgeId,
          before: x.before,
          after: x.after,
          se: x.se,
          informed: x.informed,
        })),
        fits: r.fits.map((f) => ({
          series: f.name,
          target: f.target,
          before: { rmse: f.before.rmse, nse: f.before.nse, r2: f.before.r2 },
          after: { rmse: f.after.rmse, nse: f.after.nse, r2: f.after.r2 },
        })),
        sseBefore: r.sseBefore,
        sseAfter: r.sseAfter,
        iterations: r.iterations,
        runs: r.runs,
        stop: r.stop,
      };
    }

    case 'propose_energese': {
      const source = s(a, 'source') ?? '';
      if (!source.trim()) refuse('Give the whole script.');
      if (!ctx.runEnergese) refuse('Running Energese scripts is not available here.');
      const out = await ctx.runEnergese(source, m);
      if (!out.ok)
        refuse(
          `The script did not build: ${[...out.problems, ...out.logs].slice(0, 12).join(' · ')}`
        );
      const next = out.model;
      const { changed, kept } = compareInputs(m, next);
      if (Object.keys(kept).length) next._provenance = kept;
      else delete next._provenance;
      commit(
        next,
        `Build from an Energese script: ${next.nodes.length} symbols, ${next.edges.length} flows`,
        changed,
        s(a, 'why')
      );
      return {
        symbols: next.nodes.length,
        flows: next.edges.length,
        assumed: changed.length,
        logs: out.logs,
        checks: checksOf(ctx.draft),
      };
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
    // Money circulates and never goes to a heat sink (odum_reference “money”).
    .filter((x) => kindOfCarrierId(m, x.carrier) !== 'monetary')
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
