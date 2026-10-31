/**
 * Reading and writing model files (FR-IO-001..003). `parseModel` accepts a
 * GSSK Studio file, a plain GSSK kernel model, or a gssk-dia export, and
 * returns a normalised studio model plus notes on anything it changed or
 * dropped — an import never silently rewrites a model (ADR 0006).
 */
import { isNodeType } from './catalogue.ts';
import { parseForcing } from './forcing.ts';
import { tidyGroups } from './groups.ts';
import { isIconHref } from './icons.ts';
import { uniqueId } from './ids.ts';
import {
  DEFAULT_CONFIG,
  EDGE_LOGICS,
  METHODS,
  type Boundary,
  CARRIER_KINDS,
  type Carrier,
  type CarrierKind,
  type Transaction,
  type Group,
  type Icon,
  type EdgeLogic,
  type Method,
  type ModelEdge,
  type ModelNode,
  type NodeType,
  type ObservationSeries,
  type StudioModel,
} from './types.ts';

export const FILE_EXTENSION = '.gssk.json';

/** gssk-dia's visual-only type names, and the kernel type each one is. */
const LEGACY_TYPES: Record<string, NodeType> = {
  transaction: 'exchange',
  amplifier: 'gain',
  receiver: 'loop_limited',
  box: 'misc_box',
};

export class ModelFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelFormatError';
  }
}

export interface ParseResult {
  model: StudioModel;
  notes: string[];
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export function parseModel(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ModelFormatError(`Not JSON: ${(e as Error).message}`);
  }
  return normaliseModel(raw);
}

export function normaliseModel(raw: unknown): ParseResult {
  if (!isObj(raw) || !Array.isArray(raw.nodes)) {
    throw new ModelFormatError('Not a model: there is no "nodes" list.');
  }
  const notes: string[] = [];
  const taken = new Set<string>();

  const meta = isObj(raw.metadata) ? raw.metadata : {};
  const name = str(meta.name) ?? str(raw.title) ?? 'Imported model';
  const description = str(meta.description);

  const nodes: ModelNode[] = [];
  raw.nodes.forEach((rn: unknown, i: number) => {
    if (!isObj(rn)) throw new ModelFormatError(`Node ${i + 1} is not an object.`);
    const id = str(rn.id);
    if (!id) throw new ModelFormatError(`Node ${i + 1} has no id.`);
    let type = rn.type;
    if (typeof type === 'string' && LEGACY_TYPES[type]) {
      notes.push(`“${id}”: gssk-dia type “${type}” is the kernel's “${LEGACY_TYPES[type]}”.`);
      type = LEGACY_TYPES[type];
    }
    if (!isNodeType(type)) {
      throw new ModelFormatError(
        `Node “${id}” has a type the studio does not draw: ${String(type)}.`
      );
    }
    const v = isObj(rn.visual) ? rn.visual : {};
    const x = num(v.x);
    const y = num(v.y);
    const node: ModelNode = {
      id,
      type,
      value: num(rn.value) ?? 0,
      visual: {
        // Unplaced nodes go on a grid, left to right, so nothing overlaps.
        x: x ?? 120 + (i % 5) * 180,
        y: y ?? 120 + Math.floor(i / 5) * 160,
        label: str(v.label) ?? str(rn.label) ?? id,
      },
    };
    const cap = num(v.capacity);
    if (cap !== undefined) node.visual.capacity = cap;
    const scale = num(v.scale);
    if (scale !== undefined && scale > 0 && scale !== 1) node.visual.scale = scale;
    const rotation = num(v.rotation);
    if (rotation !== undefined && rotation % 360 !== 0) node.visual.rotation = rotation;
    const icon = str(v.icon);
    if (icon) node.visual.icon = icon;
    if (x === undefined || y === undefined)
      notes.push(`“${id}” had no position; placed on a grid.`);
    const carrier = str(rn.carrier);
    if (carrier) node.carrier = carrier;
    if (isObj(rn.params)) {
      const p: NonNullable<ModelNode['params']> = {};
      for (const k of [
        'k',
        'C',
        'threshold',
        'price',
        'k_production',
        'k_respiration',
        'k_metabolism',
      ] as const) {
        const n = num(rn.params[k]);
        if (n !== undefined) p[k] = n;
      }
      const pn = str(rn.params.price_node);
      if (pn) p.price_node = pn;
      if (Object.keys(p).length) node.params = p;
    }
    const nf = parseForcing(rn.forcing);
    if (nf) node.forcing = nf;
    else if (rn.forcing !== undefined)
      notes.push(`“${id}”: its forcing was not understood and was left out.`);
    if (rn.dataType !== undefined) {
      notes.push(
        `“${id}”: its data-stream mapping (dataType ${String(rn.dataType)}) is not kept; import observations as CSV with a column named “${id}” to compare them.`
      );
    }
    taken.add(id);
    nodes.push(node);
  });

  const edges: ModelEdge[] = [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  rawEdges.forEach((re: unknown, i: number) => {
    if (!isObj(re)) throw new ModelFormatError(`Flow ${i + 1} is not an object.`);
    const origin = str(re.origin);
    const target = str(re.target);
    if (!origin || !target)
      throw new ModelFormatError(`Flow ${i + 1} needs an origin and a target.`);
    let id = str(re.id);
    if (!id || taken.has(id)) {
      const fresh = uniqueId(`${origin}_to_${target}`, taken);
      notes.push(
        id
          ? `Flow id “${id}” was used twice; renamed “${fresh}”.`
          : `Flow ${origin}→${target} had no id; named “${fresh}”.`
      );
      id = fresh;
    }
    taken.add(id);
    let logic: EdgeLogic = 'linear';
    if (EDGE_LOGICS.includes(re.logic as EdgeLogic)) logic = re.logic as EdgeLogic;
    else if (re.logic !== undefined)
      throw new ModelFormatError(`Flow “${id}” has an unknown logic: ${String(re.logic)}.`);
    const rp = isObj(re.params) ? re.params : {};
    let k = num(rp.k);
    if (k === undefined) {
      k = 1;
      notes.push(`Flow “${id}” had no rate k; set to 1.`);
    }
    const edge: ModelEdge = { id, origin, target, logic, params: { k } };
    const control = str(rp.control_node) ?? str(re.control_node);
    if (control) edge.params.control_node = control;
    const threshold = num(rp.threshold);
    if (threshold !== undefined) edge.params.threshold = threshold;
    const numerator = str(rp.numerator_node);
    if (numerator) edge.params.numerator_node = numerator;
    const carrier = str(re.carrier);
    if (carrier) edge.carrier = carrier;
    const ef = parseForcing(re.forcing);
    if (ef) edge.forcing = ef;
    else if (re.forcing !== undefined)
      notes.push(`Flow “${id}”: its forcing was not understood and was left out.`);
    const coupled = str(re.coupled_edge);
    if (coupled) edge.coupled_edge = coupled;
    const v = isObj(re.visual) ? re.visual : {};
    const pt = (p: unknown) =>
      isObj(p) && num(p.x) !== undefined && num(p.y) !== undefined
        ? { x: p.x as number, y: p.y as number }
        : undefined;
    const c1 = pt(v.ctrl1);
    const c2 = pt(v.ctrl2);
    const sensor = v.sensor === true;
    const transaction = parseTransaction(v.transaction);
    if (c1 || c2 || sensor || transaction) {
      edge.visual = {
        ...(c1 ? { ctrl1: c1 } : {}),
        ...(c2 ? { ctrl2: c2 } : {}),
        ...(sensor ? { sensor: true } : {}),
        ...(transaction ? { transaction } : {}),
      };
    }
    edges.push(edge);
  });

  const rc = isObj(raw.config) ? raw.config : {};
  let method: Method = DEFAULT_CONFIG.method;
  if (rc.method === 'incipient') {
    method = 'expm';
    notes.push("Method “incipient” is the kernel's deprecated alias of “expm”.");
  } else if (METHODS.includes(rc.method as Method)) method = rc.method as Method;
  const config = {
    t_start: num(rc.t_start) ?? DEFAULT_CONFIG.t_start,
    t_end: num(rc.t_end) ?? DEFAULT_CONFIG.t_end,
    dt: num(rc.dt) ?? DEFAULT_CONFIG.dt,
    method,
  };

  const diagram = isObj(raw._diagram) ? raw._diagram : {};
  const rawBoundaries = Array.isArray(diagram.boundaries)
    ? diagram.boundaries
    : Array.isArray(raw.boundaries)
      ? raw.boundaries
      : [];
  const boundaries: Boundary[] = [];
  for (const rb of rawBoundaries) {
    if (!isObj(rb)) continue;
    const [x, y, w, h] = [num(rb.x), num(rb.y), num(rb.w), num(rb.h)];
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    const id =
      str(rb.id) && !taken.has(rb.id as string) ? (rb.id as string) : uniqueId('boundary', taken);
    taken.add(id);
    boundaries.push({ id, x, y, w, h, label: str(rb.label) ?? '' });
  }

  // Zoom groups (FR-GRP-001): members must exist and sit in one group only.
  const groups: Group[] = [];
  const placed = new Set<string>();
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const rg of Array.isArray(diagram.groups) ? diagram.groups : []) {
    if (!isObj(rg) || !Array.isArray(rg.nodes)) continue;
    const id =
      str(rg.id) && !taken.has(rg.id as string) ? (rg.id as string) : uniqueId('group', taken);
    taken.add(id);
    const members = rg.nodes.filter(
      (n): n is string => typeof n === 'string' && nodeIds.has(n) && !placed.has(n)
    );
    for (const n of members) placed.add(n);
    groups.push({
      id,
      label: str(rg.label) ?? id,
      nodes: members,
      collapsed: rg.collapsed === true,
      ...(str(rg.parent) ? { parent: str(rg.parent) } : {}),
    });
  }

  // The model's own icons (FR-EDIT-014): images as data URLs, nothing else.
  const icons: Icon[] = [];
  for (const ri of Array.isArray(diagram.icons) ? diagram.icons : []) {
    if (!isObj(ri)) continue;
    const href = str(ri.href);
    if (!href || !isIconHref(href)) {
      notes.push(
        `Icon “${String(ri.label ?? ri.id)}” was not an image this app draws and was left out.`
      );
      continue;
    }
    const id =
      str(ri.id) && !taken.has(ri.id as string) ? (ri.id as string) : uniqueId('icon', taken);
    taken.add(id);
    icons.push({ id, label: str(ri.label) ?? id, href });
  }

  const observations: ObservationSeries[] = [];
  const known = new Set([...nodes.map((n) => n.id), ...edges.map((e) => `flow:${e.id}`)]);
  for (const ro of Array.isArray(raw._observations) ? raw._observations : []) {
    if (!isObj(ro) || !Array.isArray(ro.times) || !Array.isArray(ro.values)) continue;
    const times = ro.times.map((t) => num(t) ?? NaN);
    const values = ro.values.map((v) => num(v) ?? NaN);
    if (times.length !== values.length || times.some((t) => Number.isNaN(t))) {
      notes.push(`Observations “${String(ro.name ?? ro.id)}” were malformed and left out.`);
      continue;
    }
    const id = str(ro.id) ?? uniqueId('obs', taken);
    const target = str(ro.target);
    observations.push({
      id,
      name: str(ro.name) ?? id,
      target: target && known.has(target) ? target : null,
      times,
      values,
      ...(str(ro.source) ? { source: str(ro.source) } : {}),
    });
  }

  const rs = isObj(raw._energese) ? raw._energese : {};
  const script = str(rs.source);
  const scriptHash = str(rs.modelHash);

  const carriers = parseCarriers(raw.carriers, notes);
  const model: StudioModel = {
    metadata: { schema_version: 4, name, ...(description ? { description } : {}) },
    config,
    nodes,
    edges,
    ...(carriers.length ? { carriers } : {}),
    _diagram: {
      boundaries,
      ...(groups.length ? { groups } : {}),
      ...(icons.length ? { icons } : {}),
    },
    ...(observations.length ? { _observations: observations } : {}),
    ...(script && scriptHash ? { _energese: { source: script, modelHash: scriptHash } } : {}),
  };
  tidyGroups(model);
  return { model, notes };
}

/** A transaction marking (FR-TRX-001): a purpose code and tags, both optional. */
function parseTransaction(raw: unknown): Transaction | undefined {
  if (raw === true) return {};
  if (!isObj(raw)) return undefined;
  const t: Transaction = {};
  const purpose = str(raw.purpose);
  if (purpose) t.purpose = purpose;
  if (Array.isArray(raw.tags)) {
    const tags = raw.tags.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (tags.length) t.tags = tags;
  }
  return t;
}

/** The kernel's `carriers` list, with the studio's `_` fields (FR-TYP-001). */
function parseCarriers(raw: unknown, notes: string[]): Carrier[] {
  const out: Carrier[] = [];
  const seen = new Set<string>();
  for (const rc of Array.isArray(raw) ? raw : []) {
    const id = isObj(rc) ? str(rc.id) : undefined;
    if (!isObj(rc) || !id) continue;
    if (seen.has(id)) {
      notes.push(`Carrier “${id}” was listed twice; the second was left out.`);
      continue;
    }
    seen.add(id);
    const c: Carrier = { id };
    const unit = str(rc.unit);
    if (unit) c.unit = unit;
    if (typeof rc.conserved === 'boolean') c.conserved = rc.conserved;
    const label = str(rc._label);
    if (label) c._label = label;
    if (CARRIER_KINDS.includes(rc._kind as CarrierKind)) c._kind = rc._kind as CarrierKind;
    const currency = str(rc._currency);
    if (currency) c._currency = currency;
    const dti = str(rc._dti);
    if (dti) c._dti = dti;
    out.push(c);
  }
  return out;
}

/** The file contents for a model: pretty, stable, loadable by GSSK_Init as-is. */
export function serialiseModel(m: StudioModel): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}

export function fileNameFor(m: StudioModel): string {
  const base =
    m.metadata.name
      .trim()
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'model';
  return `${base}${FILE_EXTENSION}`;
}
