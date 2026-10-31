/**
 * The domain-neutral GSSK model builder (ADR 0012): kernel node types and
 * flow logics, nothing Odum-specific. Domain libraries — Energese, and any
 * other — are constructs over this API: they take a `GsskModel` and add nodes
 * and flows through `addNode` and `addEdge`.
 *
 * `synth()` returns the model document (ADR 0011). The JSON is canonical;
 * the builder only produces it, field for field in the order `normaliseModel`
 * writes, so a synthesized model serialises exactly as a loaded one does.
 */
import { parseForcing } from '../../model/forcing.ts';
import { tidyGroups } from '../../model/groups.ts';
import { uniqueId } from '../../model/ids.ts';
import {
  DEFAULT_CONFIG,
  type Boundary,
  type Carrier,
  type CarrierKind,
  type Transaction,
  type EdgeLogic,
  type Forcing,
  type Group,
  type Method,
  type ModelEdge,
  type ModelNode,
  type NodeType,
  type ObservationSeries,
  type Point,
  type StudioModel,
} from '../../model/types.ts';
import { layoutUnplaced } from './layout.ts';

/** A node added to a model; constructs that wrap a node expose this shape. */
export interface NodeRef {
  readonly id: string;
  readonly model: GsskModel;
}

export interface EdgeRef {
  readonly id: string;
  readonly model: GsskModel;
}

/** A node named by handle, or by id (for a node declared later). */
export type NodeLike = NodeRef | string;

/** A zoom group named by handle, or by id. */
export type GroupLike = { readonly id: string } | string;

export interface GroupInput {
  id?: string;
  /** The group this one is nested in. */
  parent?: GroupLike;
  /** Packed: drawn as one symbol. Omitted: kept from the previous model, else unpacked. */
  collapsed?: boolean;
}

/** Kernel node parameters, by their kernel names; `price_node` takes a node. */
export interface NodeParamsInput {
  k?: number;
  C?: number;
  threshold?: number;
  price?: number;
  k_production?: number;
  k_respiration?: number;
  k_metabolism?: number;
  price_node?: NodeLike;
}

export interface NodeInput {
  id?: string;
  /** Initial quantity, supply or level, by type (SPEC §5.2). Default 0. */
  value?: number;
  carrier?: string;
  params?: NodeParamsInput;
  /** Diagram position. Omitted: kept from the previous model, else laid out. */
  at?: readonly [number, number];
  /** Reference level for the storage gauge. */
  capacity?: number;
  /** Drawn size, 1 as drawn. */
  scale?: number;
  /** Turned clockwise, in degrees. */
  rotation?: number;
  /** Drawn as in the icon view: `builtin:<name>` or one of the model's icons. */
  icon?: string;
  /** Drives the held value over time (sources and constants, FR-FRC-001). */
  forcing?: Forcing;
}

export interface EdgeInput {
  id?: string;
  k: number;
  control?: NodeLike;
  threshold?: number;
  numerator?: NodeLike;
  carrier?: string;
  /** Odum's sensor on the flow (FR-EDIT-010). */
  sensor?: boolean;
  /** Bézier control offsets from the origin and target anchors. */
  ctrl1?: readonly [number, number];
  ctrl2?: readonly [number, number];
  /** Drives the rate k over time, overriding k (FR-FRC-001). */
  forcing?: Forcing;
  /** The kernel's `coupled_edge`, by id; a transaction sets it for you (`markTransaction`). */
  coupled?: string;
}

/** A carrier (FR-TYP-001, ADR 0015): a UCUM unit, or a currency for money. */
export interface CarrierInput {
  label?: string;
  /** UCUM code: `kW.h`, `kL`, `kg`, `By`. */
  unit?: string;
  conserved?: boolean;
  /** Only when the unit cannot tell. */
  kind?: CarrierKind;
  /** ISO 4217 code for fiat money. */
  currency?: string;
  /** ISO 24165 DTI for a crypto-asset. */
  dti?: string;
}

export interface ModelInput {
  description?: string;
  tStart?: number;
  tEnd?: number;
  dt?: number;
  method?: Method;
}

export interface SynthOptions {
  /**
   * The model this one replaces (FR-SDK-004): nodes and flows the script
   * leaves unplaced keep their position and curve by id, groups whose
   * packing it leaves unset keep it, and observations are kept.
   */
  previous?: StudioModel;
}

const NODE_PARAM_ORDER = [
  'k',
  'C',
  'threshold',
  'price',
  'k_production',
  'k_respiration',
  'k_metabolism',
] as const;

const pt = (p: readonly [number, number] | undefined): Point | undefined =>
  p ? { x: p[0], y: p[1] } : undefined;

/** A forcing in the document's own key order; one the kernel schema would not take is refused. */
function forcing(f: Forcing, where: string): Forcing {
  const parsed = parseForcing(f);
  if (!parsed) throw new Error(`${where}: “${String(f.waveform)}” is not a forcing waveform.`);
  return parsed;
}

/** A flow's keys in the order a loaded file has them, so synthesized and loaded models serialise alike. */
function ordered(e: ModelEdge): ModelEdge {
  const v = e.visual;
  const visual = v && {
    ...(v.ctrl1 ? { ctrl1: v.ctrl1 } : {}),
    ...(v.ctrl2 ? { ctrl2: v.ctrl2 } : {}),
    ...(v.sensor ? { sensor: true } : {}),
    ...(v.transaction
      ? {
          transaction: {
            ...(v.transaction.purpose !== undefined ? { purpose: v.transaction.purpose } : {}),
            ...(v.transaction.tags?.length ? { tags: [...v.transaction.tags] } : {}),
          },
        }
      : {}),
  };
  return {
    id: e.id,
    origin: e.origin,
    target: e.target,
    logic: e.logic,
    params: e.params,
    ...(e.carrier !== undefined ? { carrier: e.carrier } : {}),
    ...(e.forcing !== undefined ? { forcing: e.forcing } : {}),
    ...(e.coupled_edge !== undefined ? { coupled_edge: e.coupled_edge } : {}),
    ...(visual && Object.keys(visual).length ? { visual } : {}),
  };
}

export class GsskModel {
  readonly name: string;
  private readonly input: ModelInput;
  private readonly nodes: { node: ModelNode; placed: boolean }[] = [];
  private readonly edges: ModelEdge[] = [];
  private readonly boundaries: Boundary[] = [];
  private readonly groups: { group: Group; collapsed?: boolean }[] = [];
  private readonly carriers: Carrier[] = [];
  private readonly taken = new Set<string>();

  constructor(name: string, input: ModelInput = {}) {
    this.name = name;
    this.input = input;
  }

  private claim(id: string | undefined, fallback: string, what: string): string {
    if (id === undefined) {
      const fresh = uniqueId(fallback, this.taken);
      this.taken.add(fresh);
      return fresh;
    }
    if (this.taken.has(id)) throw new Error(`${what} id “${id}” is already used in this model.`);
    this.taken.add(id);
    return id;
  }

  private ref(n: NodeLike): string {
    if (typeof n === 'string') return n;
    if (n.model !== this) throw new Error(`Node “${n.id}” belongs to another model.`);
    return n.id;
  }

  addNode(type: NodeType, label: string, input: NodeInput = {}): NodeRef {
    const id = this.claim(input.id, label, 'Node');
    const at = pt(input.at);
    const node: ModelNode = {
      id,
      type,
      value: input.value ?? 0,
      visual: {
        x: at?.x ?? 0,
        y: at?.y ?? 0,
        label,
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.scale !== undefined ? { scale: input.scale } : {}),
        ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
      },
    };
    if (input.carrier) node.carrier = input.carrier;
    const p = input.params;
    if (p) {
      const params: NonNullable<ModelNode['params']> = {};
      for (const k of NODE_PARAM_ORDER) if (p[k] !== undefined) params[k] = p[k];
      if (p.price_node !== undefined) params.price_node = this.ref(p.price_node);
      if (Object.keys(params).length) node.params = params;
    }
    if (input.forcing) node.forcing = forcing(input.forcing, `Node “${id}”`);
    this.nodes.push({ node, placed: at !== undefined });
    return { id, model: this };
  }

  addEdge(origin: NodeLike, target: NodeLike, logic: EdgeLogic, input: EdgeInput): EdgeRef {
    const o = this.ref(origin);
    const t = this.ref(target);
    const id = this.claim(input.id, `${o}_to_${t}`, 'Flow');
    const edge: ModelEdge = { id, origin: o, target: t, logic, params: { k: input.k } };
    if (input.control !== undefined) edge.params.control_node = this.ref(input.control);
    if (input.threshold !== undefined) edge.params.threshold = input.threshold;
    if (input.numerator !== undefined) edge.params.numerator_node = this.ref(input.numerator);
    if (input.carrier) edge.carrier = input.carrier;
    if (input.forcing) edge.forcing = forcing(input.forcing, `Flow “${id}”`);
    if (input.coupled !== undefined) edge.coupled_edge = input.coupled;
    const c1 = pt(input.ctrl1);
    const c2 = pt(input.ctrl2);
    if (c1 || c2 || input.sensor) {
      edge.visual = {
        ...(c1 ? { ctrl1: c1 } : {}),
        ...(c2 ? { ctrl2: c2 } : {}),
        ...(input.sensor ? { sensor: true } : {}),
      };
    }
    this.edges.push(edge);
    return { id, model: this };
  }

  /** Declare what flows: Odum's Code, the kernel's `carriers` entry. */
  addCarrier(id: string, input: CarrierInput = {}): { readonly id: string } {
    if (this.carriers.some((c) => c.id === id))
      throw new Error(`Carrier “${id}” is already declared in this model.`);
    const c: Carrier = { id };
    if (input.unit !== undefined) c.unit = input.unit;
    if (input.conserved !== undefined) c.conserved = input.conserved;
    if (input.label !== undefined) c._label = input.label;
    if (input.kind !== undefined) c._kind = input.kind;
    if (input.currency !== undefined) c._currency = input.currency;
    if (input.dti !== undefined) c._dti = input.dti;
    this.carriers.push(c);
    return { id };
  }

  /**
   * Odum's transaction (FR-TRX-001): mark a flow, and pair it with the money
   * flow that pays for it (or is paid for by it). Without `counter`, the
   * marking stands alone and the model's checks say a counter-flow is needed.
   */
  markTransaction(
    flow: EdgeRef | string,
    transaction: Transaction = {},
    counter?: EdgeRef | string
  ): void {
    const e = this.edge(flow);
    e.visual = { ...e.visual, transaction: structuredClone(transaction) };
    if (counter !== undefined) {
      const c = this.edge(counter);
      e.coupled_edge = c.id;
      c.coupled_edge = e.id;
    }
  }

  private edge(ref: EdgeRef | string): ModelEdge {
    const id = typeof ref === 'string' ? ref : ref.id;
    if (typeof ref !== 'string' && ref.model !== this)
      throw new Error(`Flow “${id}” belongs to another model.`);
    const e = this.edges.find((x) => x.id === id);
    if (!e) throw new Error(`There is no flow “${id}” (declare it before its transaction).`);
    return e;
  }

  addBoundary(
    label: string,
    rect: { x: number; y: number; w: number; h: number },
    input: { id?: string } = {}
  ): { readonly id: string } {
    const id = this.claim(input.id, 'boundary', 'Boundary');
    this.boundaries.push({ id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, label });
    return { id };
  }

  /** A zoom group (FR-GRP-001): editor-only, it never changes what the kernel runs. */
  addGroup(
    label: string,
    members: readonly NodeLike[],
    input: GroupInput = {}
  ): {
    readonly id: string;
  } {
    const id = this.claim(input.id, 'group', 'Group');
    const parent =
      input.parent === undefined
        ? undefined
        : typeof input.parent === 'string'
          ? input.parent
          : input.parent.id;
    this.groups.push({
      group: {
        id,
        label,
        nodes: members.map((n) => this.ref(n)),
        collapsed: input.collapsed ?? false,
        ...(parent !== undefined ? { parent } : {}),
      },
      ...(input.collapsed !== undefined ? { collapsed: input.collapsed } : {}),
    });
    return { id };
  }

  /** The model document (ADR 0011). Each call returns a fresh copy. */
  synth(options: SynthOptions = {}): StudioModel {
    const prev = options.previous;
    const prevNodes = new Map(prev?.nodes.map((n) => [n.id, n]));
    const prevEdges = new Map(prev?.edges.map((e) => [e.id, e]));

    const nodes = this.nodes.map(({ node }) => structuredClone(node));
    const unplaced = new Set<string>();
    this.nodes.forEach(({ placed }, i) => {
      if (placed) return;
      const n = nodes[i]!;
      const old = prevNodes.get(n.id);
      if (old) {
        n.visual.x = old.visual.x;
        n.visual.y = old.visual.y;
        if (n.visual.capacity === undefined && old.visual.capacity !== undefined) {
          n.visual.capacity = old.visual.capacity;
        }
        if (n.visual.scale === undefined && old.visual.scale !== undefined) {
          n.visual.scale = old.visual.scale;
        }
        if (n.visual.rotation === undefined && old.visual.rotation !== undefined) {
          n.visual.rotation = old.visual.rotation;
        }
        if (n.visual.icon === undefined && old.visual.icon !== undefined) {
          n.visual.icon = old.visual.icon;
        }
      } else unplaced.add(n.id);
    });

    const edges = this.edges.map((e) => {
      const edge = structuredClone(e);
      const old = prevEdges.get(e.id);
      if (old?.visual && old.origin === e.origin && old.target === e.target) {
        const ctrl1 = edge.visual?.ctrl1 ?? old.visual.ctrl1;
        const ctrl2 = edge.visual?.ctrl2 ?? old.visual.ctrl2;
        const sensor = edge.visual?.sensor;
        const transaction = edge.visual?.transaction;
        if (ctrl1 || ctrl2 || sensor || transaction) {
          edge.visual = {
            ...(ctrl1 ? { ctrl1: { ...ctrl1 } } : {}),
            ...(ctrl2 ? { ctrl2: { ...ctrl2 } } : {}),
            ...(sensor ? { sensor: true } : {}),
            ...(transaction ? { transaction } : {}),
          };
        }
      }
      return ordered(edge);
    });

    layoutUnplaced(nodes, edges, unplaced);

    const observations: ObservationSeries[] = [];
    if (prev?._observations) {
      const known = new Set([...nodes.map((n) => n.id), ...edges.map((e) => `flow:${e.id}`)]);
      for (const o of prev._observations) {
        const copy = structuredClone(o);
        if (copy.target !== null && !known.has(copy.target)) copy.target = null;
        observations.push(copy);
      }
    }

    const prevGroups = new Map(prev?._diagram.groups?.map((g) => [g.id, g]));
    const groups = this.groups.map(({ group, collapsed }) => {
      const g = structuredClone(group);
      if (collapsed === undefined) g.collapsed = prevGroups.get(g.id)?.collapsed ?? false;
      return g;
    });

    const c = this.input;
    const model: StudioModel = {
      metadata: {
        schema_version: 4,
        name: this.name,
        ...(c.description ? { description: c.description } : {}),
      },
      config: {
        t_start: c.tStart ?? DEFAULT_CONFIG.t_start,
        t_end: c.tEnd ?? DEFAULT_CONFIG.t_end,
        dt: c.dt ?? DEFAULT_CONFIG.dt,
        method: c.method ?? DEFAULT_CONFIG.method,
      },
      nodes,
      edges,
      ...(this.carriers.length ? { carriers: structuredClone(this.carriers) } : {}),
      _diagram: {
        boundaries: structuredClone(this.boundaries),
        ...(groups.length ? { groups } : {}),
        // Pictures are data, not structure: kept from the model this replaces, like observations.
        ...(prev?._diagram.icons?.length ? { icons: structuredClone(prev._diagram.icons) } : {}),
      },
      ...(observations.length ? { _observations: observations } : {}),
    };
    // As loading a file does: drop members that are not nodes, and empty groups.
    tidyGroups(model);
    return model;
  }
}
