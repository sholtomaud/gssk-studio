/**
 * Interaction processes (ADR 0018): Odum's work gate as a production process.
 * A process names its main input, its controls (each used up or only read),
 * its product target and its heat sink. Its pathways are ordinary kernel
 * edges, tagged `visual.process`, that `syncProcess` keeps in step with it:
 *
 * - product: input → target, with the process's logic and controls;
 * - heat: input → heat sink, the used energy, with the same logic;
 * - use: each used-up control → heat sink, J = k·Q_control·Q_input·(others),
 *   so an ingredient is drawn down in proportion to production.
 *
 * Each pathway keeps its own k, carrier and forcing across syncs. Operations
 * return a new model and never mutate their input.
 */
import { uniqueId } from './ids.ts';
import {
  cloneModel,
  setControls,
  type EdgeLogic,
  type ModelEdge,
  type Process,
  type ProcessPathway,
  type StudioModel,
} from './types.ts';

/** A new pathway's rate, and a heat or use pathway's, until the person sets one. */
export const DEFAULT_K = { product: 0.1, heat: 0.01, use: 0.01 } as const;

export function processesOf(m: StudioModel): Process[] {
  return m._diagram.processes ?? [];
}

export function findProcess(m: StudioModel, id: string): Process | undefined {
  return processesOf(m).find((p) => p.id === id);
}

/** The process a flow is a pathway of, if any. */
export function processOfEdge(m: StudioModel, e: ModelEdge): Process | undefined {
  const tag = e.visual?.process;
  return tag ? findProcess(m, tag.id) : undefined;
}

/** A process's flows, by pathway. */
export function pathways(
  m: StudioModel,
  id: string
): { product?: ModelEdge; heat?: ModelEdge; uses: Map<string, ModelEdge> } {
  const out: { product?: ModelEdge; heat?: ModelEdge; uses: Map<string, ModelEdge> } = {
    uses: new Map(),
  };
  for (const e of m.edges) {
    const t = e.visual?.process;
    if (t?.id !== id) continue;
    if (t.role === 'product') out.product = e;
    else if (t.role === 'heat') out.heat = e;
    else if (t.control) out.uses.set(t.control, e);
  }
  return out;
}

/** What a process still needs before it has flows, in words; empty when complete. */
export function processGaps(p: Process): string[] {
  const gaps: string[] = [];
  if (!p.input) gaps.push('a main input');
  if (p.controls.length === 0)
    gaps.push(p.op === 'product' ? 'a control or second input' : 'a control');
  if (!p.target) gaps.push('a product target');
  return gaps;
}

const LOGIC: Record<Process['op'], EdgeLogic> = {
  product: 'interaction',
  divide: 'ratio',
  subtract: 'subtract',
};

const allIds = (m: StudioModel) =>
  new Set([
    ...m.nodes.map((n) => n.id),
    ...m.edges.map((e) => e.id),
    ...m._diagram.boundaries.map((b) => b.id),
    ...(m._diagram.groups ?? []).map((g) => g.id),
    ...processesOf(m).map((p) => p.id),
  ]);

/** The heat sink a process drains to: its own, the nearest one below it, or a new one. */
function ensureSink(m: StudioModel, p: Process): string {
  if (p.sink && m.nodes.some((n) => n.id === p.sink && n.type === 'sink')) return p.sink;
  const below = m.nodes
    .filter((n) => n.type === 'sink' && n.visual.y > p.y)
    .sort(
      (a, b) =>
        Math.hypot(a.visual.x - p.x, a.visual.y - p.y) -
        Math.hypot(b.visual.x - p.x, b.visual.y - p.y)
    );
  if (below[0]) return below[0].id;
  const id = uniqueId(`${p.label ?? p.id} used energy`, allIds(m));
  m.nodes.push({
    id,
    type: 'sink',
    value: 0,
    visual: { x: p.x, y: p.y + 140, label: 'Used energy' },
  });
  return id;
}

/**
 * Bring a process's flows in step with it, in place on a model being built:
 * create the pathways it needs, update their ends, logic and controls, keep
 * their rates, and remove the ones it no longer has. An incomplete process
 * has no flows.
 */
export function syncProcess(m: StudioModel, id: string): void {
  const p = findProcess(m, id);
  const have = p ? pathways(m, id) : { uses: new Map<string, ModelEdge>() };
  const keep = new Set<ModelEdge>();
  if (p) {
    // Remember every pathway's rate, so one dropped now comes back with its k.
    const rates = { ...p.rates };
    if (have.product) rates.product = have.product.params.k;
    if (have.heat) rates.heat = have.heat.params.k;
    for (const [c, e] of have.uses) rates[`use:${c}`] = e.params.k;
    if (Object.keys(rates).length) p.rates = rates;
  }
  if (p && processGaps(p).length === 0 && !(p.op !== 'product' && p.controls.length > 1)) {
    p.sink = ensureSink(m, p);
    const controls = p.controls.map((c) => c.node);
    const put = (
      existing: ModelEdge | undefined,
      tag: ProcessPathway,
      origin: string,
      target: string,
      logic: EdgeLogic,
      ctrl: string[],
      k: number
    ) => {
      let e = existing;
      const key = tag.role === 'use' ? `use:${tag.control}` : tag.role;
      k = p.rates?.[key] ?? k;
      if (!e) {
        e = {
          id: uniqueId(
            `${p.label ?? p.id}_${tag.role}${tag.control ? `_${tag.control}` : ''}`,
            allIds(m)
          ),
          origin,
          target,
          logic,
          params: { k },
        };
        m.edges.push(e);
      }
      e.origin = origin;
      e.target = target;
      e.logic = logic;
      setControls(e, ctrl);
      e.visual = { ...e.visual, process: tag };
      keep.add(e);
    };
    put(
      have.product,
      { id, role: 'product' },
      p.input!,
      p.target!,
      LOGIC[p.op],
      controls,
      DEFAULT_K.product
    );
    put(have.heat, { id, role: 'heat' }, p.input!, p.sink, LOGIC[p.op], controls, DEFAULT_K.heat);
    for (const c of p.controls) {
      if (!c.used) continue;
      const others = [p.input!, ...controls.filter((x) => x !== c.node)];
      put(
        have.uses.get(c.node),
        { id, role: 'use', control: c.node },
        c.node,
        p.sink,
        'interaction',
        others,
        DEFAULT_K.use
      );
    }
  }
  m.edges = m.edges.filter((e) => e.visual?.process?.id !== id || keep.has(e));
  if (p) {
    const rates = { ...p.rates };
    for (const e of keep) {
      const t = e.visual!.process!;
      rates[t.role === 'use' ? `use:${t.control}` : t.role] = e.params.k;
    }
    if (Object.keys(rates).length) p.rates = rates;
  }
}

function edit(
  m: StudioModel,
  id: string,
  change: (p: Process, next: StudioModel) => void
): StudioModel {
  if (!findProcess(m, id)) return m;
  const next = cloneModel(m);
  change(findProcess(next, id)!, next);
  syncProcess(next, id);
  return next;
}

/** A new process at a point, wired as far as given. */
export function createProcess(
  m: StudioModel,
  at: { x: number; y: number },
  spec: Partial<Pick<Process, 'op' | 'input' | 'target' | 'sink' | 'controls' | 'label'>> = {}
): { model: StudioModel; id: string } {
  const next = cloneModel(m);
  const id = uniqueId(spec.label ?? 'interaction', allIds(next));
  next._diagram.processes = [
    ...processesOf(next),
    {
      id,
      op: spec.op ?? 'product',
      x: at.x,
      y: at.y,
      controls: spec.controls ?? [],
      ...(spec.label ? { label: spec.label } : {}),
      ...(spec.input ? { input: spec.input } : {}),
      ...(spec.target ? { target: spec.target } : {}),
      ...(spec.sink ? { sink: spec.sink } : {}),
    },
  ];
  syncProcess(next, id);
  return { model: next, id };
}

/**
 * Make a flow the product pathway of a new process controlled by `control`
 * (dropping a symbol onto a flow): its rate, carrier and forcing are kept,
 * and a used-energy pathway to a heat sink is added.
 */
export function flowToProcess(
  m: StudioModel,
  edgeId: string,
  control: string,
  at: { x: number; y: number }
): { model: StudioModel; id: string | null } {
  const e = m.edges.find((x) => x.id === edgeId);
  if (!e || e.visual?.process || !m.nodes.some((n) => n.id === control))
    return { model: m, id: null };
  // A control may be the target itself: a unit feeding back to its own intake (Odum's autocatalysis).
  if (control === e.origin) return { model: m, id: null };
  const next = cloneModel(m);
  const id = uniqueId('interaction', allIds(next));
  const flow = next.edges.find((x) => x.id === edgeId)!;
  flow.visual = { ...flow.visual, process: { id, role: 'product' } };
  delete flow.visual.ctrl1;
  delete flow.visual.ctrl2;
  next._diagram.processes = [
    ...processesOf(next),
    {
      id,
      op: 'product',
      x: at.x,
      y: at.y,
      input: e.origin,
      target: e.target,
      controls: [{ node: control, used: false }],
    },
  ];
  syncProcess(next, id);
  return { model: next, id };
}

/**
 * Wire a symbol into a process: the main input first, then a read-only
 * control. The product target can be a control too: its feedback.
 */
export function wireIn(m: StudioModel, id: string, node: string): StudioModel {
  const p = findProcess(m, id);
  if (!p || node === p.input || p.controls.some((c) => c.node === node)) return m;
  return edit(m, id, (q) => {
    if (!q.input) q.input = node;
    else q.controls.push({ node, used: false });
  });
}

/** Set the main input, the left-hand pathway with the most energy. */
export function setInput(m: StudioModel, id: string, input: string): StudioModel {
  const p = findProcess(m, id);
  if (!p || p.controls.some((c) => c.node === input)) return m;
  return edit(m, id, (q) => (q.input = input));
}

/** Add a read-only control, whether or not the process has its main input yet. */
export function addControl(m: StudioModel, id: string, node: string): StudioModel {
  const p = findProcess(m, id);
  if (!p || node === p.input || p.controls.some((c) => c.node === node)) return m;
  return edit(m, id, (q) => q.controls.push({ node, used: false }));
}

export function setProduct(m: StudioModel, id: string, target: string): StudioModel {
  const p = findProcess(m, id);
  if (!p || target === p.input) return m;
  return edit(m, id, (q) => (q.target = target));
}

export function setControlUsed(
  m: StudioModel,
  id: string,
  node: string,
  used: boolean
): StudioModel {
  return edit(m, id, (q) => {
    const c = q.controls.find((x) => x.node === node);
    if (c) c.used = used;
  });
}

export function removeControl(m: StudioModel, id: string, node: string): StudioModel {
  return edit(m, id, (q) => (q.controls = q.controls.filter((c) => c.node !== node)));
}

export function setOp(m: StudioModel, id: string, op: Process['op']): StudioModel {
  return edit(m, id, (q) => (q.op = op));
}

export function setSink(m: StudioModel, id: string, sink: string): StudioModel {
  if (!m.nodes.some((n) => n.id === sink && n.type === 'sink')) return m;
  return edit(m, id, (q) => (q.sink = sink));
}

export function renameProcess(m: StudioModel, id: string, label: string): StudioModel {
  return edit(m, id, (q) => {
    if (label.trim()) q.label = label.trim();
    else delete q.label;
  });
}

/** Move chevrons by an offset (they move with the symbols around them). */
export function moveProcesses(
  m: StudioModel,
  ids: readonly string[],
  dx: number,
  dy: number
): StudioModel {
  if (ids.length === 0 || (dx === 0 && dy === 0)) return m;
  const next = cloneModel(m);
  for (const p of processesOf(next)) {
    if (!ids.includes(p.id)) continue;
    p.x += dx;
    p.y += dy;
  }
  return next;
}

/** Remove a process and its flows; its heat sink and the symbols it joined stay. */
export function removeProcess(m: StudioModel, id: string): StudioModel {
  if (!findProcess(m, id)) return m;
  const next = cloneModel(m);
  next.edges = next.edges.filter((e) => e.visual?.process?.id !== id);
  const left = processesOf(next).filter((p) => p.id !== id);
  if (left.length) next._diagram.processes = left;
  else delete next._diagram.processes;
  return next;
}

/**
 * After symbols are deleted or loaded from a file, in place: forget ends that
 * are gone, untag flows whose process is gone, and resync every process.
 */
export function tidyProcesses(m: StudioModel): void {
  const ids = new Set(m.nodes.map((n) => n.id));
  for (const p of processesOf(m)) {
    if (p.input && !ids.has(p.input)) delete p.input;
    if (p.target && !ids.has(p.target)) delete p.target;
    if (p.sink && !ids.has(p.sink)) delete p.sink;
    p.controls = p.controls.filter((c) => ids.has(c.node));
  }
  const live = new Set(processesOf(m).map((p) => p.id));
  for (const e of m.edges) {
    if (e.visual?.process && !live.has(e.visual.process.id)) {
      const { process: _gone, ...rest } = e.visual;
      if (Object.keys(rest).length) e.visual = rest;
      else delete e.visual;
    }
  }
  for (const p of processesOf(m)) syncProcess(m, p.id);
}

/** Follow a symbol's rename, in place. */
export function renameInProcesses(m: StudioModel, from: string, to: string): void {
  for (const p of processesOf(m)) {
    if (p.input === from) p.input = to;
    if (p.target === from) p.target = to;
    if (p.sink === from) p.sink = to;
    for (const c of p.controls) if (c.node === from) c.node = to;
  }
  for (const e of m.edges) if (e.visual?.process?.control === from) e.visual.process.control = to;
}

/** How a process reads, for titles and the assistant: “A × B → P”. */
export function describeProcess(m: StudioModel, p: Process): string {
  const name = (id?: string) => (id ? (m.nodes.find((n) => n.id === id)?.visual.label ?? id) : '?');
  const sign = p.op === 'product' ? ' × ' : p.op === 'divide' ? ' ÷ ' : ' − ';
  const inputs = [
    name(p.input),
    ...p.controls.map((c) => `${name(c.node)}${c.used ? '' : ' (read)'}`),
  ];
  return `${inputs.join(sign)} → ${name(p.target)}`;
}

/** A process's chevron label and kind, for drawing: `*` once per multiplied control. */
export function opMark(p: Process): string {
  if (p.op === 'divide') return '÷';
  if (p.op === 'subtract') return '−';
  return Array.from({ length: Math.max(1, p.controls.length) }, () => '*').join(' ');
}
