/**
 * Observed series from a CSV file (FR-OBS-001): the first column is time,
 * each other column one series. A column is mapped to the node whose id or
 * label matches its heading (case and punctuation ignored); the rest stay
 * unmapped until the user picks a target.
 */
import { uniqueId } from '../model/ids.ts';
import type { ObservationSeries, StudioModel } from '../model/types.ts';
import { parseCsv } from './csv.ts';

export class ObservationFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObservationFormatError';
  }
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Targets a series can measure: nodes, and flows that carry a sensor. */
export function observationTargets(m: StudioModel): { value: string; label: string }[] {
  return [
    ...m.nodes.map((n) => ({ value: n.id, label: n.visual.label ?? n.id })),
    ...m.edges
      .filter((e) => e.visual?.sensor)
      .map((e) => ({ value: `flow:${e.id}`, label: `${e.id} (J)` })),
  ];
}

export function guessTarget(m: StudioModel, heading: string): string | null {
  const k = key(heading);
  if (!k) return null;
  for (const t of observationTargets(m)) {
    if (key(t.value) === k || key(t.value.replace(/^flow:/, '')) === k || key(t.label) === k)
      return t.value;
  }
  return null;
}

/** A number from a CSV cell, accepting a decimal comma when no point is present. */
function num(cell: string | undefined): number {
  const s = (cell ?? '').trim();
  if (s === '') return NaN;
  const v = Number(/^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s);
  return Number.isFinite(v) ? v : NaN;
}

export function observationsFromCsv(
  text: string,
  model: StudioModel,
  source: string
): ObservationSeries[] {
  const { headers, rows } = parseCsv(text);
  if (headers.length < 2) {
    throw new ObservationFormatError(
      'Need a time column and at least one value column, with a heading row.'
    );
  }
  const times = rows.map((r) => num(r[0]));
  const bad = times.findIndex((t) => !Number.isFinite(t));
  if (bad >= 0) {
    throw new ObservationFormatError(
      `Row ${bad + 2}: “${rows[bad]?.[0] ?? ''}” is not a time. The first column must be numeric model time.`
    );
  }
  const taken = new Set((model._observations ?? []).map((o) => o.id));
  return headers.slice(1).flatMap((name, j) => {
    const pts = rows
      .map((r, i) => ({ t: times[i] ?? NaN, v: num(r[j + 1]) }))
      .filter((p) => Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    if (pts.length === 0) return [];
    const id = uniqueId(name || `series_${j + 1}`, taken);
    taken.add(id);
    return [
      {
        id,
        name: name || `Series ${j + 1}`,
        target: guessTarget(model, name),
        times: pts.map((p) => p.t),
        values: pts.map((p) => p.v),
        source,
      },
    ];
  });
}
