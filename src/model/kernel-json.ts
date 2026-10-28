/**
 * The JSON the kernel is given (SPEC §7.1): the model without its editor-only
 * parts. The kernel would ignore `visual` and `_diagram`, but sending only
 * what it reads keeps the run manifest's model hash about the model, not the
 * layout — moving a symbol must not change a run's identity.
 */
import { conservedOf, unitOf } from './carriers.ts';
import type { NodeType, StudioModel } from './types.ts';

/**
 * The member that holds a composite's state, by composite type. GSSK_Init
 * resolves a composite named as an edge END to its port, but not one named as
 * a CONTROL (kernel request K-1, SPEC §17): there the studio names the member
 * itself, `{instance}__{member}`, with the instance truncated as the kernel
 * truncates it.
 */
const STATE_MEMBER: Partial<Record<NodeType, string>> = {
  producer: 'body',
  consumer: 'body',
  misc_box: 'box',
};

export function memberId(instance: string, member: string): string {
  return `${instance.slice(0, 29)}__${member}`;
}

export interface KernelModel {
  metadata: { schema_version: 4; name: string };
  config: StudioModel['config'];
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  carriers?: { id: string; unit?: string; conserved: boolean }[];
}

function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function toKernelModel(m: StudioModel): KernelModel {
  const types = new Map(m.nodes.map((n) => [n.id, n.type]));
  /** A node reference the kernel reads as a level: a composite becomes its state member. */
  const level = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    const t = types.get(id);
    const member = t ? STATE_MEMBER[t] : undefined;
    return member ? memberId(id, member) : id;
  };
  return {
    metadata: { schema_version: 4, name: m.metadata.name },
    config: { ...m.config },
    nodes: m.nodes.map((n) =>
      defined({
        id: n.id,
        type: n.type,
        value: n.value,
        carrier: n.carrier,
        params:
          n.params && Object.keys(n.params).length
            ? defined({ ...n.params, price_node: level(n.params.price_node) })
            : undefined,
        forcing: n.forcing,
      })
    ),
    edges: m.edges.map((e) =>
      defined({
        id: e.id,
        origin: e.origin,
        target: e.target,
        logic: e.logic,
        carrier: e.carrier,
        params: defined({
          ...e.params,
          control_node: level(e.params.control_node),
          numerator_node: level(e.params.numerator_node),
        }),
        forcing: e.forcing,
        coupled_edge: e.coupled_edge,
      })
    ),
    // Without a carrier list the kernel gets none, so older models keep their hash.
    ...(m.carriers?.length
      ? {
          carriers: m.carriers.map((c) =>
            defined({ id: c.id, unit: unitOf(c), conserved: conservedOf(c) })
          ) as { id: string; unit?: string; conserved: boolean }[],
        }
      : {}),
  };
}

/** Canonical JSON: keys sorted, so equal models give equal strings and hashes. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  );
}
