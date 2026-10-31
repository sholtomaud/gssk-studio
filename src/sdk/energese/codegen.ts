/**
 * Any model as Energese TypeScript (FR-SDK-002): the generated form ADR 0011
 * gives every model. Declarative, one statement per symbol, flow and
 * boundary; running it and calling `synth()` gives back the same document
 * (FR-SDK-003). Ids are written only where the builder would not derive the
 * same one from the label, so the code stays readable.
 */
import { uniqueId } from '../../model/ids.ts';
import type { Forcing, ModelEdge, ModelNode, StudioModel } from '../../model/types.ts';
import { CONSTRUCTS } from './index.ts';

export interface CodegenOptions {
  /** The module the script imports the SDK from. */
  importFrom?: string;
}

const RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends ' +
    'false finally for function if import in instanceof new null return super switch this throw ' +
    'true try typeof var void while with yield let static implements interface package private ' +
    'protected public await arguments eval undefined NaN Infinity m ener'
  ).split(' ')
);

/** A camelCase identifier for an id, unique among `used`. */
function identifier(id: string, used: Set<string>): string {
  const words = id.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let base = words
    .map((w, i) =>
      i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w[0]!.toUpperCase() + w.slice(1)
    )
    .join('');
  if (!base || /^[0-9]/.test(base)) base = `n${base}`;
  let name = base;
  for (let i = 2; RESERVED.has(name) || used.has(name); i++) name = `${base}${i}`;
  used.add(name);
  return name;
}

function str(s: string): string {
  return `'${JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
}

function num(n: number): string {
  return Object.is(n, -0) ? '-0' : String(n);
}

/** A value to print: code as it stands, or an object or array laid out to fit. */
type Lit = string | { obj: [string, Lit][] } | { arr: Lit[] };

function flat(l: Lit): string {
  if (typeof l === 'string') return l;
  if ('arr' in l) return `[${l.arr.map(flat).join(', ')}]`;
  return l.obj.length ? `{ ${l.obj.map(([k, v]) => `${k}: ${flat(v)}`).join(', ')} }` : '{}';
}

/** On one line if it fits in `room`, else broken as Prettier breaks it. */
function format(l: Lit, indent: string, room: number): string {
  const one = flat(l);
  if (typeof l === 'string' || one.length <= room) return one;
  const inner = `${indent}  `;
  if ('arr' in l) {
    return `[\n${l.arr.map((v) => `${inner}${format(v, inner, LINE - inner.length - 1)},`).join('\n')}\n${indent}]`;
  }
  const line = ([k, v]: [string, Lit]) => {
    const head = `${inner}${k}: `;
    const value = format(v, inner, LINE - head.length - 1);
    // A string too long for the line moves under its key.
    return typeof v === 'string' && head.length + value.length + 1 > LINE
      ? `${inner}${k}:\n${inner}  ${value},`
      : `${head}${value},`;
  };
  return `{\n${l.obj.map(line).join('\n')}\n${indent}}`;
}

const obj = (entries: [string, Lit][], indent: string, room: number) =>
  format({ obj: entries }, indent, room);

/** A forcing as an object literal, in the document's key order. */
function forcingLit(f: Forcing): Lit {
  return {
    obj: Object.entries(f)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]): [string, Lit] => [
        k,
        typeof v === 'string'
          ? str(v)
          : Array.isArray(v)
            ? { arr: v.map((x) => num(x as number)) }
            : num(v as number),
      ]),
  };
}

const KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (k: string) => (KEY_RE.test(k) ? k : str(k));

/** Typed props each construct offers, kernel parameter → prop name. */
const TYPED: Partial<Record<ModelNode['type'], Record<string, string>>> = {
  producer: { k_production: 'kProduction', k_respiration: 'kRespiration' },
  consumer: { k_metabolism: 'kMetabolism' },
  exchange: { price: 'price', price_node: 'priceNode' },
  switch: { threshold: 'threshold' },
  gain: { k: 'k' },
  loop_limited: { k: 'k', C: 'C' },
};

const LINE = 100;

export function toEnergese(m: StudioModel, options: CodegenOptions = {}): string {
  const from = options.importFrom ?? 'energese';
  const out: string[] = [];
  out.push(`import * as ener from ${str(from)};`, '');

  const cfg: [string, string][] = [];
  if (m.metadata.description) cfg.push(['description', str(m.metadata.description)]);
  cfg.push(
    ['tStart', num(m.config.t_start)],
    ['tEnd', num(m.config.t_end)],
    ['dt', num(m.config.dt)],
    ['method', str(m.config.method)]
  );
  const head = `const m = new ener.Model(${str(m.metadata.name)}, `;
  out.push(`${head}${obj(cfg, '', LINE - head.length - 2)});`);

  const taken = new Set<string>();
  const used = new Set<string>();
  const vars = new Map<string, string>();
  const declared = new Set<string>();
  /** A node reference: its variable if declared above, else its id. */
  const ref = (id: string) => (declared.has(id) ? vars.get(id)! : str(id));

  // Variables first, so a reference to a later node can still be named by id.
  for (const n of m.nodes) if (!vars.has(n.id)) vars.set(n.id, identifier(n.id, used));

  const carriers = m.carriers ?? [];
  if (carriers.length) out.push('', '// Carriers');
  for (const c of carriers) {
    const entries: [string, Lit][] = [];
    if (c._label !== undefined) entries.push(['label', str(c._label)]);
    if (c.unit !== undefined) entries.push(['unit', str(c.unit)]);
    if (c.conserved !== undefined) entries.push(['conserved', String(c.conserved)]);
    if (c._kind !== undefined) entries.push(['kind', str(c._kind)]);
    if (c._currency !== undefined) entries.push(['currency', str(c._currency)]);
    if (c._dti !== undefined) entries.push(['dti', str(c._dti)]);
    const lead = `new ener.Carrier(m, ${str(c.id)}`;
    out.push(
      entries.length ? `${lead}, ${obj(entries, '', LINE - lead.length - 4)});` : `${lead});`
    );
  }

  if (m.nodes.length) out.push('', '// Symbols');
  for (const n of m.nodes) {
    const label = n.visual.label ?? n.id;
    const entries: [string, Lit][] = [];
    if (uniqueId(label, taken) !== n.id) entries.push(['id', str(n.id)]);
    taken.add(n.id);
    entries.push(['value', num(n.value)]);
    const typed = TYPED[n.type] ?? {};
    const raw: [string, string][] = [];
    for (const [k, v] of Object.entries(n.params ?? {})) {
      if (v === undefined) continue;
      const value = k === 'price_node' ? ref(v as string) : num(v as number);
      const prop = typed[k];
      if (prop) entries.push([prop, value]);
      else raw.push([key(k), value]);
    }
    if (n.carrier) entries.push(['carrier', str(n.carrier)]);
    entries.push(['at', `[${num(n.visual.x)}, ${num(n.visual.y)}]`]);
    if (n.visual.capacity !== undefined) entries.push(['capacity', num(n.visual.capacity)]);
    if (n.visual.scale !== undefined) entries.push(['scale', num(n.visual.scale)]);
    if (n.visual.rotation !== undefined) entries.push(['rotation', num(n.visual.rotation)]);
    if (n.visual.icon !== undefined) entries.push(['icon', str(n.visual.icon)]);
    if (n.forcing) entries.push(['forcing', forcingLit(n.forcing)]);
    if (raw.length) entries.push(['params', { obj: raw }]);
    const v = vars.get(n.id)!;
    const lead = `const ${v} = new ener.${CONSTRUCTS[n.type]}(m, ${str(label)}, `;
    out.push(`${lead}${obj(entries, '', LINE - lead.length - 2)});`);
    declared.add(n.id);
  }

  // Transactions pair their flows themselves, so those flows need names.
  const byId = new Map(m.edges.map((e) => [e.id, e]));
  const reciprocal = (e: ModelEdge) => {
    const p = e.coupled_edge === undefined ? undefined : byId.get(e.coupled_edge);
    return p && p.id !== e.id && p.coupled_edge === e.id ? p : undefined;
  };
  const marked = m.edges.filter((e) => e.visual?.transaction);
  const paired = new Set<string>();
  for (const e of marked) {
    const p = reciprocal(e);
    if (p) paired.add(e.id).add(p.id);
  }
  const flowVars = new Map<string, string>();
  for (const e of m.edges) {
    if (e.visual?.transaction || paired.has(e.id)) flowVars.set(e.id, identifier(e.id, used));
  }

  if (m.edges.length) out.push('', '// Flows');
  for (const e of m.edges) {
    const def = uniqueId(`${e.origin}_to_${e.target}`, taken);
    taken.add(e.id);
    const props: [string, Lit][] = [];
    if (def !== e.id) props.push(['id', str(e.id)]);
    if (e.carrier) props.push(['carrier', str(e.carrier)]);
    if (e.forcing) props.push(['forcing', forcingLit(e.forcing)]);
    // A pairing no transaction makes (a hand-built or broken one) is written as it stands.
    if (e.coupled_edge !== undefined && !paired.has(e.id))
      props.push(['coupled', str(e.coupled_edge)]);
    if (e.visual?.sensor) props.push(['sensor', 'true']);
    if (e.visual?.ctrl1)
      props.push(['ctrl1', `[${num(e.visual.ctrl1.x)}, ${num(e.visual.ctrl1.y)}]`]);
    if (e.visual?.ctrl2)
      props.push(['ctrl2', `[${num(e.visual.ctrl2.x)}, ${num(e.visual.ctrl2.y)}]`]);
    const fv = flowVars.get(e.id);
    const lead = `${fv ? `const ${fv} = ` : ''}new ener.Flow(m, ${ref(e.origin)}, ${ref(e.target)}, ${flowLogic(e, ref)}`;
    out.push(props.length ? `${lead}, ${obj(props, '', LINE - lead.length - 4)});` : `${lead});`);
  }

  if (marked.length) out.push('', '// Transactions');
  for (const e of marked) {
    const t = e.visual!.transaction!;
    const p = reciprocal(e);
    const props: [string, Lit][] = [];
    if (p) props.push(['counter', flowVars.get(p.id)!]);
    if (t.purpose !== undefined) props.push(['purpose', str(t.purpose)]);
    if (t.tags?.length) props.push(['tags', { arr: t.tags.map(str) }]);
    const lead = `new ener.Transaction(m, ${flowVars.get(e.id)!}`;
    out.push(props.length ? `${lead}, ${obj(props, '', LINE - lead.length - 4)});` : `${lead});`);
  }

  if (m._diagram.boundaries.length) out.push('', '// Boundaries');
  for (const b of m._diagram.boundaries) {
    const entries: [string, string][] = [];
    if (uniqueId('boundary', taken) !== b.id) entries.push(['id', str(b.id)]);
    taken.add(b.id);
    entries.push(['x', num(b.x)], ['y', num(b.y)], ['w', num(b.w)], ['h', num(b.h)]);
    const lead = `new ener.Boundary(m, ${str(b.label)}, `;
    out.push(`${lead}${obj(entries, '', LINE - lead.length - 2)});`);
  }

  const groups = m._diagram.groups ?? [];
  if (groups.length) out.push('', '// Groups');
  /** A group another group names as its parent, later in the list, gets a variable. */
  const groupVars = new Map<string, string>();
  groups.forEach((g, i) => {
    if (groups.slice(i + 1).some((c) => c.parent === g.id))
      groupVars.set(g.id, identifier(g.id, used));
  });
  const declaredGroups = new Set<string>();
  for (const g of groups) {
    const props: [string, Lit][] = [];
    if (uniqueId('group', taken) !== g.id) props.push(['id', str(g.id)]);
    taken.add(g.id);
    if (g.parent !== undefined) {
      const pv = groupVars.get(g.parent);
      props.push(['parent', pv && declaredGroups.has(g.parent) ? pv : str(g.parent)]);
    }
    if (g.collapsed) props.push(['collapsed', 'true']);
    const v = groupVars.get(g.id);
    const members = flat({ arr: g.nodes.map(ref) });
    const lead = `${v ? `const ${v} = ` : ''}new ener.Group(m, ${str(g.label)}, ${members}`;
    out.push(props.length ? `${lead}, ${obj(props, '', LINE - lead.length - 4)});` : `${lead});`);
    declaredGroups.add(g.id);
  }

  out.push('', 'export default m;', '');
  return out.join('\n');
}

/** The helper call for an edge's logic, or the general `ener.logic` when no helper fits. */
function flowLogic(e: ModelEdge, ref: (id: string) => string): string {
  const { k, control_node: c, threshold: t, numerator_node: n } = e.params;
  const K = num(k);
  const only = (...keys: string[]) =>
    (['control_node', 'threshold', 'numerator_node'] as const).every(
      (p) => keys.includes(p) || e.params[p] === undefined
    );
  switch (e.logic) {
    case 'linear':
    case 'constant':
    case 'reversible':
      if (only()) return `ener.${e.logic}(${K})`;
      break;
    case 'interaction':
    case 'subtract':
      if (c !== undefined && only('control_node')) return `ener.${e.logic}(${K}, ${ref(c)})`;
      break;
    case 'threshold':
      if (t !== undefined && only('threshold')) return `ener.threshold(${K}, ${num(t)})`;
      break;
    case 'limit':
      if (c !== undefined && only('control_node')) return `ener.limit(${K}, ${ref(c)})`;
      if (t !== undefined && only('threshold')) return `ener.limit(${K}, ${num(t)})`;
      break;
    case 'ratio':
      if (c !== undefined) {
        const opts: [string, string][] = [];
        if (n !== undefined) opts.push(['numerator', ref(n)]);
        if (t !== undefined) opts.push(['floor', num(t)]);
        return `ener.ratio(${K}, ${ref(c)}${opts.length ? `, ${obj(opts, '', LINE)}` : ''})`;
      }
      break;
  }
  const p: [string, string][] = [['k', K]];
  if (c !== undefined) p.push(['control', ref(c)]);
  if (t !== undefined) p.push(['threshold', num(t)]);
  if (n !== undefined) p.push(['numerator', ref(n)]);
  return `ener.logic(${str(e.logic)}, ${obj(p, '', LINE)})`;
}
