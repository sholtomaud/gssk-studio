/**
 * Model checks the editor runs on every change (FR-VAL-001). They catch
 * what the kernel would reject — and say so in words, pointing at the node or
 * flow at fault — plus the shapes that load but rarely mean what was meant.
 * The kernel remains the authority: a model that passes here can still be
 * refused by GSSK_Init, and the run reports that verbatim.
 */
import { logicFor, symbolFor } from './catalogue.ts';
import { canForceNode, forcingProblems } from './forcing.ts';
import type { StudioModel } from './types.ts';

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  ref?: { kind: 'node' | 'edge' | 'config'; id: string };
}

/** Steps above this make the browser run long enough to look hung (NFR-PERF-002). */
export const MAX_STEPS = 500_000;

const ID_RE = /^[A-Za-z0-9_.-]+$/;

export function validate(m: StudioModel): Issue[] {
  const issues: Issue[] = [];
  const err = (code: string, message: string, ref?: Issue['ref']) =>
    issues.push({ severity: 'error', code, message, ...(ref ? { ref } : {}) });
  const warn = (code: string, message: string, ref?: Issue['ref']) =>
    issues.push({ severity: 'warning', code, message, ...(ref ? { ref } : {}) });

  if (m.nodes.length === 0) err('empty', 'Add at least one symbol to the diagram.');

  const nodeIds = new Set<string>();
  for (const n of m.nodes) {
    const ref = { kind: 'node' as const, id: n.id };
    if (!n.id || n.id.length > 63 || !ID_RE.test(n.id)) {
      err('node-id', `“${n.id}” is not a usable id: use letters, digits, _ . - (max 63).`, ref);
    }
    if (nodeIds.has(n.id)) err('node-dup', `Two nodes are called “${n.id}”.`, ref);
    nodeIds.add(n.id);
    if (symbolFor(n.type).composite && n.id.length > 29) {
      warn('composite-id', `“${n.id}” is long for a ${n.type}: member ids truncate at 29.`, ref);
    }
    if (!Number.isFinite(n.value)) err('node-value', `“${n.id}” has no numeric value.`, ref);
    if (n.forcing) {
      if (!canForceNode(n.type)) {
        err(
          'forcing-node',
          n.type === 'storage'
            ? `Storage “${n.id}” cannot be forced: its level is the integral of its flows. Force a source or a flow into it.`
            : `A ${symbolFor(n.type).label.toLowerCase()} cannot be forced; only sources and constants can.`,
          ref
        );
      }
      for (const p of forcingProblems(n.forcing)) err('forcing', `“${n.id}”: ${p}.`, ref);
    }
  }

  const edgeIds = new Set<string>();
  const touched = new Set<string>();
  for (const e of m.edges) {
    const ref = { kind: 'edge' as const, id: e.id };
    if (!e.id || e.id.length > 63 || !ID_RE.test(e.id)) {
      err('edge-id', `Flow id “${e.id}” is not usable.`, ref);
    }
    if (edgeIds.has(e.id) || nodeIds.has(e.id))
      err('edge-dup', `The id “${e.id}” is used twice.`, ref);
    edgeIds.add(e.id);
    for (const end of [e.origin, e.target]) {
      if (!nodeIds.has(end))
        err('edge-end', `Flow “${e.id}” connects to a missing node “${end}”.`, ref);
      touched.add(end);
    }
    if (!Number.isFinite(e.params.k)) err('edge-k', `Flow “${e.id}” needs a numeric rate k.`, ref);
    if (e.forcing)
      for (const p of forcingProblems(e.forcing)) err('forcing', `Flow “${e.id}”: ${p}.`, ref);

    const spec = logicFor(e.logic);
    const control = e.params.control_node;
    if (control !== undefined) {
      touched.add(control);
      if (!nodeIds.has(control)) {
        err('control-missing', `Flow “${e.id}” is controlled by a missing node “${control}”.`, ref);
      }
    }
    const threshold = e.params.threshold;
    for (const need of spec.needs) {
      if (need === 'control_node' && control === undefined) {
        err('control-needed', `${spec.label} flow “${e.id}” needs a control node.`, ref);
      }
      if (need === 'threshold' && (threshold === undefined || !Number.isFinite(threshold))) {
        err('threshold-needed', `Threshold flow “${e.id}” needs a threshold θ.`, ref);
      }
      if (need === 'control_or_threshold' && control === undefined && !((threshold ?? 0) > 0)) {
        err('limit-needed', `Limit flow “${e.id}” needs a control node or a threshold C > 0.`, ref);
      }
    }

    const target = m.nodes.find((n) => n.id === e.target);
    if (
      target &&
      (target.type === 'source' || target.type === 'constant') &&
      e.logic !== 'reversible'
    ) {
      warn(
        'into-source',
        `Flow “${e.id}” runs into ${target.type} “${target.id}”, which holds a fixed value.`,
        ref
      );
    }
    const origin = m.nodes.find((n) => n.id === e.origin);
    if (origin?.type === 'sink' && e.logic !== 'reversible') {
      warn(
        'out-of-sink',
        `Flow “${e.id}” leaves the heat sink “${origin.id}”; degraded energy does no further work.`,
        ref
      );
    }
  }

  for (const n of m.nodes) {
    if (m.nodes.length > 1 && !touched.has(n.id)) {
      warn('isolated', `“${n.visual.label ?? n.id}” is not connected to anything.`, {
        kind: 'node',
        id: n.id,
      });
    }
  }

  const c = m.config;
  const cref = { kind: 'config' as const, id: 'config' };
  if (!(c.dt > 0)) err('dt', 'The time step must be greater than zero.', cref);
  if (!(c.t_end > c.t_start)) err('span', 'The end time must be after the start time.', cref);
  if (c.dt > 0 && c.t_end > c.t_start && (c.t_end - c.t_start) / c.dt > MAX_STEPS) {
    err(
      'steps',
      `That is more than ${MAX_STEPS.toLocaleString('en')} steps: lengthen the step or shorten the run.`,
      cref
    );
  }
  if (c.method === 'auto' && (m.nodes.some((n) => n.forcing) || m.edges.some((e) => e.forcing))) {
    // Kernel request K-7 (SPEC §17): auto's dual-solver check fails on forced models.
    warn(
      'forcing-auto',
      'Forced models disagree with the auto method’s solver check on nearly every step: choose rk4.',
      cref
    );
  }
  return issues;
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
