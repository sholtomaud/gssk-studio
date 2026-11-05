/**
 * Building blocks (ADR 0017, M7b): a packed group saved to its own file, to
 * be placed into other models. A block carries its symbols and flows, the
 * carriers and icons they use, its interaction processes and inner groups,
 * where its numbers come from, and its interface: the symbols inside that
 * flows from outside reach (its ports, FR-GRP-001), each with the carrier it
 * takes.
 *
 * Placing a block adds a copy with fresh ids as a packed group that
 * remembers the block's id, version and hash, and its ports, so a flow wired
 * to it can be checked against them.
 */
import { canonicalJson } from './kernel-json.ts';
import { groupCentre, findGroup, groupsOf, nodesIn } from './groups.ts';
import { slugify, uniqueId } from './ids.ts';
import { ModelFormatError, normaliseModel, serialiseModel } from './io.ts';
import { processesOf } from './processes.ts';
import type { Issue } from './validate.ts';
import {
  cloneModel,
  controlsOf,
  setControls,
  type BlockPort,
  type BlockRef,
  type Carrier,
  type Group,
  type ModelEdge,
  type Point,
  type Process,
  type Provenance,
  type StudioModel,
} from './types.ts';

export type { BlockPort, BlockRef } from './types.ts';

export const BLOCK_EXTENSION = '.gssk-block.json';
export const BLOCK_FORMAT = 'gssk-block';
export const BLOCK_FORMAT_VERSION = 1;

/**
 * Classification schemes a block may be coded by (ADR 0015, 0017): who it is
 * (SNA 2008 sector), its industry, a listed company's sector, what it trades,
 * what households spend on.
 */
export const CODE_SCHEMES = [
  'SNA2008',
  'ANZSIC2006',
  'ISIC4',
  'GICS',
  'CPC2.1',
  'COICOP2018',
] as const;
export type CodeScheme = (typeof CODE_SCHEMES)[number];

export interface BlockCode {
  scheme: CodeScheme;
  code: string;
  label?: string;
}

/** A goodness of fit a test asks for: at least `min` (NSE, KGE, R²). */
export const TEST_METRICS = ['nse', 'kge', 'r2'] as const;
export type TestMetric = (typeof TEST_METRICS)[number];

/** An observed series the block must reproduce (ADR 0017). */
export interface BlockTest {
  name: string;
  /** A node id, or `flow:<edge id>`, inside the block. */
  target: string;
  times: number[];
  values: number[];
  metric: TestMetric;
  min: number;
  /** Where the observations come from. */
  source?: string;
}

export interface Block {
  format: typeof BLOCK_FORMAT;
  format_version: typeof BLOCK_FORMAT_VERSION;
  /** Dotted, lower case: `au.sna.households`. */
  id: string;
  /** Semantic version: `1.0.0`. */
  version: string;
  title: string;
  description?: string;
  codes: BlockCode[];
  ports: BlockPort[];
  /** Its contents, drawn around (0, 0). Its run settings are the ones its tests run with. */
  model: StudioModel;
  tests: BlockTest[];
  /** The GSSK version it was saved on. */
  kernel?: string;
}

export const BLOCK_ID_RE = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
export const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

// ---- saving -----------------------------------------------------------------

export interface BlockMeta {
  id: string;
  version: string;
  title: string;
  description?: string;
  codes?: BlockCode[];
  /** Observation series of the model (by id) to keep as tests, each with the fit it must reach. */
  tests?: { series: string; metric: TestMetric; min: number }[];
  kernel?: string;
}

/**
 * A group's interface: each symbol inside that a flow across its edge reaches,
 * which way the flows go, and their carrier when they share one.
 */
export function groupPorts(m: StudioModel, groupId: string): BlockPort[] {
  const inside = new Set(nodesIn(m, groupId));
  const seen = new Map<string, { dir: Set<'in' | 'out'>; carriers: Set<string> }>();
  for (const e of m.edges) {
    const oi = inside.has(e.origin);
    const ti = inside.has(e.target);
    if (oi === ti) continue;
    const node = oi ? e.origin : e.target;
    const p = seen.get(node) ?? { dir: new Set(), carriers: new Set() };
    p.dir.add(oi ? 'out' : 'in');
    p.carriers.add(e.carrier ?? '');
    seen.set(node, p);
  }
  return m.nodes
    .filter((n) => seen.has(n.id))
    .map((n) => {
      const p = seen.get(n.id)!;
      const carrier = p.carriers.size === 1 ? [...p.carriers][0] : undefined;
      return {
        node: n.id,
        direction: p.dir.size === 2 ? 'both' : [...p.dir][0]!,
        ...(carrier ? { carrier } : {}),
        ...(n.visual.label ? { label: n.visual.label } : {}),
      };
    });
}

/**
 * A block from a group: what it holds, drawn around its centre, with its
 * ports. References to symbols outside it (a control, a price, a pairing)
 * cannot travel and are dropped; each is listed in `notes`.
 */
export function blockFromGroup(
  m: StudioModel,
  groupId: string,
  meta: BlockMeta
): { block: Block; notes: string[] } {
  const g = findGroup(m, groupId);
  if (!g) throw new Error(`No group ${groupId}`);
  const notes: string[] = [];
  const inside = new Set(nodesIn(m, groupId));
  const centre = groupCentre(m, groupId);
  const label = (id: string) => m.nodes.find((n) => n.id === id)?.visual.label ?? id;

  const sub = cloneModel(m);
  sub.metadata = {
    schema_version: 4,
    name: meta.title,
    ...(meta.description ? { description: meta.description } : {}),
  };
  sub.nodes = sub.nodes.filter((n) => inside.has(n.id));
  for (const n of sub.nodes) {
    n.visual.x -= centre.x;
    n.visual.y -= centre.y;
    if (n.params?.price_node !== undefined && !inside.has(n.params.price_node)) {
      notes.push(
        `${label(n.id)} read its price from ${label(n.params.price_node)}, outside; dropped.`
      );
      delete n.params.price_node;
    }
  }
  sub.edges = sub.edges.filter((e) => inside.has(e.origin) && inside.has(e.target));
  const edgeIds = new Set(sub.edges.map((e) => e.id));
  for (const e of sub.edges) {
    const controls = controlsOf(e);
    const kept = controls.filter((c) => inside.has(c));
    for (const c of controls)
      if (!inside.has(c))
        notes.push(`The flow ${e.id} read ${label(c)} as a control, outside; dropped.`);
    if (kept.length !== controls.length) setControls(e, kept);
    if (e.params.numerator_node !== undefined && !inside.has(e.params.numerator_node)) {
      notes.push(
        `The flow ${e.id} divided by ${label(e.params.numerator_node)}, outside; dropped.`
      );
      delete e.params.numerator_node;
    }
    if (e.coupled_edge !== undefined && !edgeIds.has(e.coupled_edge)) {
      notes.push(
        `The flow ${e.id} was paid for by ${e.coupled_edge}, outside; the pairing is dropped.`
      );
      delete e.coupled_edge;
    }
  }

  // Processes come along when everything they name is inside.
  const keep = (p: Process) =>
    [p.input, p.target, p.sink, ...p.controls.map((c) => c.node)].every(
      (id) => !id || inside.has(id)
    );
  const processes = processesOf(sub)
    .filter(keep)
    .map((p) => ({ ...p, x: p.x - centre.x, y: p.y - centre.y }));
  const kept = new Set(processes.map((p) => p.id));
  for (const p of processesOf(sub))
    if (!kept.has(p.id))
      notes.push(
        `Interaction ${p.label ?? p.id} reaches outside; its flows are kept as plain flows.`
      );
  for (const e of sub.edges)
    if (e.visual?.process && !kept.has(e.visual.process.id)) delete e.visual.process;

  // Groups inside it, with the outer group's place taken by the block itself.
  const inner = new Set<string>();
  const walk = (id: string) => {
    for (const c of groupsOf(m).filter((x) => x.parent === id)) {
      inner.add(c.id);
      walk(c.id);
    }
  };
  walk(groupId);
  const groups: Group[] = groupsOf(sub)
    .filter((x) => inner.has(x.id))
    .map((x) => {
      const c: Group = { ...x, nodes: [...x.nodes] };
      if (c.parent === groupId) delete c.parent;
      return c;
    });

  // Its wiring now, and any port a placed block declared that nothing is wired to yet.
  const ports = groupPorts(m, groupId);
  for (const p of g.block?.ports ?? [])
    if (inside.has(p.node) && !ports.some((x) => x.node === p.node)) ports.push({ ...p });
  const usedCarriers = new Set(
    [...sub.nodes, ...sub.edges, ...ports].map((x) => x.carrier).filter(Boolean)
  );
  const carriers = (sub.carriers ?? []).filter((c) => usedCarriers.has(c.id));
  const usedIcons = new Set(sub.nodes.map((n) => n.visual.icon).filter(Boolean));
  const icons = (sub._diagram.icons ?? []).filter((i) => usedIcons.has(i.id));
  sub._diagram = {
    boundaries: [],
    ...(groups.length ? { groups } : {}),
    ...(icons.length ? { icons } : {}),
    ...(processes.length ? { processes } : {}),
  };
  if (carriers.length) sub.carriers = carriers;
  else delete sub.carriers;

  const marks: Record<string, Provenance> = {};
  for (const [k, v] of Object.entries(m._provenance ?? {})) {
    const [kind, id] = k.split(':');
    if ((kind === 'node' && inside.has(id!)) || (kind === 'edge' && edgeIds.has(id!))) marks[k] = v;
  }
  if (Object.keys(marks).length) sub._provenance = marks;
  else delete sub._provenance;
  delete sub._observations;
  delete sub._energese;

  const reaches = (t: string) => (t.startsWith('flow:') ? edgeIds.has(t.slice(5)) : inside.has(t));
  const tests: BlockTest[] = [];
  for (const t of meta.tests ?? []) {
    const s = (m._observations ?? []).find((o) => o.id === t.series);
    if (!s || !s.target || !reaches(s.target)) {
      notes.push(
        `Observations ${s?.name ?? t.series} are not of something inside; not kept as a test.`
      );
      continue;
    }
    tests.push({
      name: s.name,
      target: s.target,
      times: [...s.times],
      values: [...s.values],
      metric: t.metric,
      min: t.min,
      ...(s.source ? { source: s.source } : {}),
    });
  }

  const block: Block = {
    format: BLOCK_FORMAT,
    format_version: BLOCK_FORMAT_VERSION,
    id: meta.id,
    version: meta.version,
    title: meta.title,
    ...(meta.description ? { description: meta.description } : {}),
    codes: meta.codes ?? [],
    ports,
    model: sub,
    tests,
    ...(meta.kernel ? { kernel: meta.kernel } : {}),
  };
  return { block, notes };
}

/** What makes a block's id and version fit to save, or the reasons they are not. */
export function metaProblems(meta: Pick<BlockMeta, 'id' | 'version' | 'title'>): string[] {
  const out: string[] = [];
  if (!BLOCK_ID_RE.test(meta.id))
    out.push('The id is lower-case letters and digits, parts joined by dots: au.sna.households.');
  if (!SEMVER_RE.test(meta.version)) out.push('The version is three numbers: 1.0.0.');
  if (!meta.title.trim()) out.push('Give the block a title.');
  return out;
}

// ---- files --------------------------------------------------------------------

/** A block as its file's JSON object, its model as a model file writes it. */
function blockJson(b: Block): Record<string, unknown> {
  return { ...b, model: JSON.parse(serialiseModel(b.model)) as unknown };
}

export function serialiseBlock(b: Block): string {
  return `${JSON.stringify(blockJson(b), null, 2)}\n`;
}

/** SHA-256 of a block's canonical JSON: what a placed block records, so a changed block is told apart. */
export async function blockHash(b: Block): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(blockJson(b)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

export function blockFileName(b: Block): string {
  return `${b.id}-${b.version}${BLOCK_EXTENSION}`;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const nums = (v: unknown): number[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? (v as number[])
    : undefined;

/** Read a block file. Throws ModelFormatError when it is not one; `notes` says what was left out. */
export function parseBlock(text: string): { block: Block; notes: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ModelFormatError(`Not JSON: ${(e as Error).message}`);
  }
  if (!isObj(raw) || raw.format !== BLOCK_FORMAT)
    throw new ModelFormatError('Not a building block: its "format" is not "gssk-block".');
  if (raw.format_version !== BLOCK_FORMAT_VERSION)
    throw new ModelFormatError(
      `A block of format version ${String(raw.format_version)}; this studio reads version ${BLOCK_FORMAT_VERSION}.`
    );
  const id = str(raw.id);
  const version = str(raw.version);
  if (!id || !BLOCK_ID_RE.test(id)) throw new ModelFormatError('The block has no valid id.');
  if (!version || !SEMVER_RE.test(version))
    throw new ModelFormatError('The block has no valid version.');
  const parsed = normaliseModel(raw.model);
  const model = parsed.model;
  const notes = [...parsed.notes];
  const nodes = new Set(model.nodes.map((n) => n.id));
  const edges = new Set(model.edges.map((e) => e.id));

  const ports: BlockPort[] = [];
  for (const rp of Array.isArray(raw.ports) ? raw.ports : []) {
    if (!isObj(rp) || !str(rp.node) || !nodes.has(rp.node as string)) {
      notes.push(`A port named a symbol the block does not have; left out.`);
      continue;
    }
    const direction = rp.direction === 'in' || rp.direction === 'out' ? rp.direction : 'both';
    ports.push({
      node: rp.node as string,
      direction,
      ...(str(rp.carrier) ? { carrier: str(rp.carrier) } : {}),
      ...(str(rp.label) ? { label: str(rp.label) } : {}),
    });
  }
  const codes: BlockCode[] = [];
  for (const rc of Array.isArray(raw.codes) ? raw.codes : []) {
    if (!isObj(rc) || !CODE_SCHEMES.includes(rc.scheme as CodeScheme) || !str(rc.code)) {
      notes.push('A classification code of a scheme this studio does not know was left out.');
      continue;
    }
    codes.push({
      scheme: rc.scheme as CodeScheme,
      code: str(rc.code)!,
      ...(str(rc.label) ? { label: str(rc.label) } : {}),
    });
  }
  const tests: BlockTest[] = [];
  for (const rt of Array.isArray(raw.tests) ? raw.tests : []) {
    const times = isObj(rt) ? nums(rt.times) : undefined;
    const values = isObj(rt) ? nums(rt.values) : undefined;
    const target = isObj(rt) ? str(rt.target) : undefined;
    const ok =
      isObj(rt) &&
      times &&
      values &&
      times.length === values.length &&
      times.length > 0 &&
      target &&
      (target.startsWith('flow:') ? edges.has(target.slice(5)) : nodes.has(target)) &&
      TEST_METRICS.includes(rt.metric as TestMetric) &&
      typeof rt.min === 'number' &&
      Number.isFinite(rt.min);
    if (!ok) {
      notes.push(
        'A test that was not a complete observed series of something in the block was left out.'
      );
      continue;
    }
    tests.push({
      name: str(rt.name) ?? target!,
      target: target!,
      times: times!,
      values: values!,
      metric: rt.metric as TestMetric,
      min: rt.min as number,
      ...(str(rt.source) ? { source: str(rt.source) } : {}),
    });
  }
  return {
    block: {
      format: BLOCK_FORMAT,
      format_version: BLOCK_FORMAT_VERSION,
      id,
      version,
      title: str(raw.title) ?? id,
      ...(str(raw.description) ? { description: str(raw.description) } : {}),
      codes,
      ports,
      model,
      tests,
      ...(str(raw.kernel) ? { kernel: str(raw.kernel) } : {}),
    },
    notes,
  };
}

// ---- placing --------------------------------------------------------------------

const sameCarrier = (a: Carrier, b: Carrier) => canonicalJson(a) === canonicalJson(b);

/**
 * Add a block to a model at `at`, as a packed group, with fresh ids for
 * everything in it. A carrier or icon the model already has with the same id
 * and meaning is shared; one that differs comes in under a new id.
 */
export function placeBlock(
  m: StudioModel,
  block: Block,
  at: Point,
  hash: string
): { model: StudioModel; groupId: string } {
  const b = cloneModel(block.model);
  const next = cloneModel(m);
  const taken = new Set([
    ...next.nodes.map((n) => n.id),
    ...next.edges.map((e) => e.id),
    ...next._diagram.boundaries.map((x) => x.id),
    ...groupsOf(next).map((g) => g.id),
    ...processesOf(next).map((p) => p.id),
  ]);
  const fresh = (id: string) => {
    const out = uniqueId(id, taken);
    taken.add(out);
    return out;
  };
  const node = new Map(b.nodes.map((n) => [n.id, fresh(n.id)]));
  const edge = new Map(b.edges.map((e) => [e.id, fresh(e.id)]));
  const group = new Map(groupsOf(b).map((g) => [g.id, fresh(g.id)]));
  const proc = new Map(processesOf(b).map((p) => [p.id, fresh(p.id)]));
  const N = (id: string) => node.get(id) ?? id;

  // Carriers and icons: shared when the same, renamed when not.
  const carrier = new Map<string, string>();
  next.carriers ??= [];
  const carrierIds = new Set(next.carriers.map((c) => c.id));
  for (const c of b.carriers ?? []) {
    const have = next.carriers.find((x) => x.id === c.id);
    if (have && sameCarrier(have, c)) continue;
    const id = have ? uniqueId(c.id, carrierIds) : c.id;
    carrierIds.add(id);
    if (id !== c.id) carrier.set(c.id, id);
    next.carriers.push({ ...c, id });
  }
  if (next.carriers.length === 0) delete next.carriers;
  const C = (id: string | undefined) => (id ? (carrier.get(id) ?? id) : id);
  const icon = new Map<string, string>();
  const iconIds = new Set((next._diagram.icons ?? []).map((i) => i.id));
  for (const i of b._diagram.icons ?? []) {
    const have = next._diagram.icons?.find((x) => x.id === i.id);
    if (have && have.href === i.href) continue;
    const id = have ? uniqueId(i.id, iconIds) : i.id;
    iconIds.add(id);
    if (id !== i.id) icon.set(i.id, id);
    (next._diagram.icons ??= []).push({ ...i, id });
  }

  for (const n of b.nodes) {
    n.id = N(n.id);
    n.visual.x += at.x;
    n.visual.y += at.y;
    if (n.carrier) n.carrier = C(n.carrier);
    if (n.visual.icon && icon.has(n.visual.icon)) n.visual.icon = icon.get(n.visual.icon);
    if (n.params?.price_node) n.params.price_node = N(n.params.price_node);
    next.nodes.push(n);
  }
  for (const e of b.edges) {
    const renamed: ModelEdge = e;
    renamed.id = edge.get(e.id) ?? e.id;
    renamed.origin = N(e.origin);
    renamed.target = N(e.target);
    if (e.carrier) renamed.carrier = C(e.carrier);
    setControls(renamed, controlsOf(e).map(N));
    if (e.params.numerator_node) renamed.params.numerator_node = N(e.params.numerator_node);
    if (e.coupled_edge) renamed.coupled_edge = edge.get(e.coupled_edge) ?? e.coupled_edge;
    const pw = e.visual?.process;
    if (pw) {
      pw.id = proc.get(pw.id) ?? pw.id;
      if (pw.control) pw.control = N(pw.control);
    }
    next.edges.push(renamed);
  }
  for (const p of processesOf(b)) {
    const q: Process = {
      ...p,
      id: proc.get(p.id) ?? p.id,
      x: p.x + at.x,
      y: p.y + at.y,
      controls: p.controls.map((c) => ({ ...c, node: N(c.node) })),
    };
    for (const f of ['input', 'target', 'sink'] as const) if (q[f]) q[f] = N(q[f]);
    (next._diagram.processes ??= []).push(q);
  }

  const inChild = new Set(groupsOf(b).flatMap((g) => g.nodes));
  const groupId = fresh(slugify(block.title) || 'block');
  const ref: BlockRef = {
    id: block.id,
    version: block.version,
    hash,
    ports: block.ports.map((p) => ({
      ...p,
      node: N(p.node),
      ...(p.carrier ? { carrier: C(p.carrier) } : {}),
    })),
  };
  const groups = (next._diagram.groups ??= []);
  groups.push({
    id: groupId,
    label: block.title,
    nodes: b.nodes.map((n) => n.id).filter((id) => ![...inChild].map(N).includes(id)),
    collapsed: true,
    block: ref,
  });
  for (const g of groupsOf(b))
    groups.push({
      ...g,
      id: group.get(g.id) ?? g.id,
      nodes: g.nodes.map(N),
      parent: g.parent ? (group.get(g.parent) ?? g.parent) : groupId,
    });

  for (const [k, v] of Object.entries(b._provenance ?? {})) {
    const [kind, id, ...rest] = k.split(':');
    const to = kind === 'node' ? N(id!) : (edge.get(id!) ?? id!);
    (next._provenance ??= {})[`${kind}:${to}:${rest.join(':')}`] = v;
  }
  return { model: next, groupId };
}

// ---- checks ----------------------------------------------------------------------

/**
 * Flows wired to a placed block (ADR 0017): each must reach one of its
 * ports, in the port's direction, carrying the port's carrier.
 */
export function blockIssues(m: StudioModel): Issue[] {
  const issues: Issue[] = [];
  const label = (id: string) => m.nodes.find((n) => n.id === id)?.visual.label ?? id;
  for (const g of groupsOf(m)) {
    if (!g.block) continue;
    const inside = new Set(nodesIn(m, g.id));
    const ports = new Map(g.block.ports.map((p) => [p.node, p]));
    for (const e of m.edges) {
      const oi = inside.has(e.origin);
      const ti = inside.has(e.target);
      if (oi === ti) continue;
      const node = oi ? e.origin : e.target;
      const way = oi ? 'out' : 'in';
      const port = ports.get(node);
      const ref = { kind: 'edge' as const, id: e.id };
      if (!port) {
        issues.push({
          severity: 'warning',
          code: 'block-port',
          message: `The flow ${e.id} reaches ${label(node)} inside the block “${g.label}”, which is not one of its ports.`,
          ref,
        });
        continue;
      }
      if (port.direction !== 'both' && port.direction !== way)
        issues.push({
          severity: 'warning',
          code: 'block-port-direction',
          message: `The block “${g.label}” takes flows ${port.direction === 'in' ? 'into' : 'out of'} ${label(node)}; ${e.id} goes the other way.`,
          ref,
        });
      if (port.carrier && (e.carrier ?? '') !== port.carrier)
        issues.push({
          severity: 'warning',
          code: 'block-port-carrier',
          message: `The block “${g.label}”’s port ${label(node)} carries ${port.carrier}; the flow ${e.id} carries ${e.carrier ?? 'nothing declared'}.`,
          ref,
        });
    }
  }
  return issues;
}
