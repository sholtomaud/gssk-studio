/**
 * Energese: Odum's Energy Systems Language as TypeScript constructs over the
 * domain-neutral GSSK builder (ADR 0012). One class per symbol (SPEC §5.2),
 * one helper per flow logic. A script builds a `Model` and default-exports
 * it; `model.synth()` is the `.gssk.json` document (ADR 0011).
 *
 *   import * as ener from 'energese';
 *   const m = new ener.Model('Grassland', { tEnd: 200, dt: 0.1, method: 'rk4' });
 *   const sun = new ener.Source(m, 'Sunlight', { value: 100 });
 *   const grass = new ener.Producer(m, 'Grass', { value: 20 });
 *   new ener.Flow(m, sun, grass, ener.linear(0.02));
 *   export default m;
 */
import type { EdgeLogic, NodeType } from '../../model/types.ts';
import {
  GsskModel,
  type EdgeRef,
  type NodeInput,
  type NodeLike,
  type NodeParamsInput,
  type NodeRef,
} from '../gssk/builder.ts';

export { GsskModel as Model } from '../gssk/builder.ts';
export type { ModelInput, NodeLike, NodeRef, SynthOptions } from '../gssk/builder.ts';

/** What every symbol takes. `params` passes kernel parameters through by kernel name. */
export interface SymbolProps {
  id?: string;
  value?: number;
  carrier?: string;
  at?: readonly [number, number];
  capacity?: number;
  params?: NodeParamsInput;
}

abstract class OdumSymbol implements NodeRef {
  readonly id: string;
  readonly model: GsskModel;

  protected constructor(
    scope: GsskModel,
    type: NodeType,
    label: string,
    props: SymbolProps,
    typed: NodeParamsInput = {}
  ) {
    const params: NodeParamsInput = { ...props.params };
    for (const [k, v] of Object.entries(typed)) {
      if (v !== undefined) (params as Record<string, unknown>)[k] = v;
    }
    const input: NodeInput = {
      ...(props.id !== undefined ? { id: props.id } : {}),
      ...(props.value !== undefined ? { value: props.value } : {}),
      ...(props.carrier !== undefined ? { carrier: props.carrier } : {}),
      ...(props.at !== undefined ? { at: props.at } : {}),
      ...(props.capacity !== undefined ? { capacity: props.capacity } : {}),
      ...(Object.keys(params).length ? { params } : {}),
    };
    const ref = scope.addNode(type, label, input);
    this.id = ref.id;
    this.model = scope;
  }
}

/** An outside input held at its value. */
export class Source extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: SymbolProps = {}) {
    super(scope, 'source', label, props);
  }
}

/** A tank: dQ/dt = inflows − outflows. */
export class Storage extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: SymbolProps = {}) {
    super(scope, 'storage', label, props);
  }
}

/** Degraded energy leaving the system. */
export class HeatSink extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: SymbolProps = {}) {
    super(scope, 'sink', label, props);
  }
}

/** A fixed level flows can read. */
export class Constant extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: SymbolProps = {}) {
    super(scope, 'constant', label, props);
  }
}

export interface ProducerProps extends SymbolProps {
  kProduction?: number;
  kRespiration?: number;
}

/** The kernel's producer composite: body, gate and heat. */
export class Producer extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: ProducerProps = {}) {
    super(scope, 'producer', label, props, {
      k_production: props.kProduction,
      k_respiration: props.kRespiration,
    });
  }
}

export interface ConsumerProps extends SymbolProps {
  kMetabolism?: number;
}

/** The kernel's consumer composite: body and heat. */
export class Consumer extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: ConsumerProps = {}) {
    super(scope, 'consumer', label, props, { k_metabolism: props.kMetabolism });
  }
}

/** A multiplicative work gate. */
export class Interaction extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: SymbolProps = {}) {
    super(scope, 'interaction', label, props);
  }
}

export interface TransactionProps extends SymbolProps {
  price?: number;
  /** A node whose level is the price, instead of a constant one. */
  priceNode?: NodeLike;
}

/** Goods one way, money the other (the kernel's `exchange`). */
export class Transaction extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: TransactionProps = {}) {
    super(scope, 'exchange', label, props, { price: props.price, price_node: props.priceNode });
  }
}

export interface SwitchProps extends SymbolProps {
  threshold?: number;
}

/** On or off around a threshold. */
export class Switch extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: SwitchProps = {}) {
    super(scope, 'switch', label, props, { threshold: props.threshold });
  }
}

export interface AmplifierProps extends SymbolProps {
  k?: number;
}

/** A constant-gain amplifier (the kernel's `gain`). */
export class Amplifier extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: AmplifierProps = {}) {
    super(scope, 'gain', label, props, { k: props.k });
  }
}

export interface ReceiverProps extends SymbolProps {
  k?: number;
  C?: number;
}

/** A self-limiting receptor, k·Q/(1+Q/C) (the kernel's `loop_limited`). */
export class Receiver extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: ReceiverProps = {}) {
    super(scope, 'loop_limited', label, props, { k: props.k, C: props.C });
  }
}

/** A subsystem not drawn in detail (the kernel's `misc_box`). */
export class Box extends OdumSymbol {
  constructor(scope: GsskModel, label: string, props: SymbolProps = {}) {
    super(scope, 'misc_box', label, props);
  }
}

/** The construct class for each kernel type, by its exported name (for codegen). */
export const CONSTRUCTS: Readonly<Record<NodeType, string>> = {
  source: 'Source',
  storage: 'Storage',
  sink: 'HeatSink',
  constant: 'Constant',
  producer: 'Producer',
  consumer: 'Consumer',
  interaction: 'Interaction',
  exchange: 'Transaction',
  switch: 'Switch',
  gain: 'Amplifier',
  loop_limited: 'Receiver',
  misc_box: 'Box',
};

/** A flow logic and its parameters, as the helpers below build it. */
export interface FlowLogic {
  logic: EdgeLogic;
  k: number;
  control?: NodeLike;
  threshold?: number;
  numerator?: NodeLike;
}

/** Any logic with any parameters, by kernel names; the helpers cover the usual shapes. */
export function logic(name: EdgeLogic, params: Omit<FlowLogic, 'logic'>): FlowLogic {
  return { logic: name, ...params };
}

/** J = k·Q₀ */
export const linear = (k: number): FlowLogic => ({ logic: 'linear', k });
/** J = k */
export const constant = (k: number): FlowLogic => ({ logic: 'constant', k });
/** J = k·(Q₀ − Q₁), signed: Odum's barbless pathway. */
export const reversible = (k: number): FlowLogic => ({ logic: 'reversible', k });
/** J = k·Q₀·Qc: a work gate controlled by `control`. */
export const interaction = (k: number, control: NodeLike): FlowLogic => ({
  logic: 'interaction',
  k,
  control,
});
/** J = max(0, k·(Q₀ − Qc)) */
export const subtract = (k: number, control: NodeLike): FlowLogic => ({
  logic: 'subtract',
  k,
  control,
});
/** J = k if Q₀ > θ else 0 */
export const threshold = (k: number, theta: number): FlowLogic => ({
  logic: 'threshold',
  k,
  threshold: theta,
});
/** J = k·Q₀/(1 + Q₀/C), with C a number or a node's level. */
export const limit = (k: number, C: number | NodeLike): FlowLogic =>
  typeof C === 'number' ? { logic: 'limit', k, threshold: C } : { logic: 'limit', k, control: C };
/** J = k·Qn/max(Qc, floor), with Qn the origin unless `numerator` names a node. */
export const ratio = (
  k: number,
  denominator: NodeLike,
  opts: { numerator?: NodeLike; floor?: number } = {}
): FlowLogic => ({
  logic: 'ratio',
  k,
  control: denominator,
  ...(opts.floor !== undefined ? { threshold: opts.floor } : {}),
  ...(opts.numerator !== undefined ? { numerator: opts.numerator } : {}),
});

export interface FlowProps {
  id?: string;
  carrier?: string;
  sensor?: boolean;
  ctrl1?: readonly [number, number];
  ctrl2?: readonly [number, number];
}

/** A pathway from `origin` to `target`. */
export class Flow implements EdgeRef {
  readonly id: string;
  readonly model: GsskModel;

  constructor(
    scope: GsskModel,
    origin: NodeLike,
    target: NodeLike,
    how: FlowLogic,
    props: FlowProps = {}
  ) {
    const ref = scope.addEdge(origin, target, how.logic, {
      k: how.k,
      ...(how.control !== undefined ? { control: how.control } : {}),
      ...(how.threshold !== undefined ? { threshold: how.threshold } : {}),
      ...(how.numerator !== undefined ? { numerator: how.numerator } : {}),
      ...props,
    });
    this.id = ref.id;
    this.model = scope;
  }
}

/** A labelled system boundary drawn beneath the symbols; never sent to the kernel. */
export class Boundary {
  readonly id: string;

  constructor(
    scope: GsskModel,
    label: string,
    rect: { x: number; y: number; w: number; h: number; id?: string }
  ) {
    this.id = scope.addBoundary(label, rect, rect.id !== undefined ? { id: rect.id } : {}).id;
  }
}
