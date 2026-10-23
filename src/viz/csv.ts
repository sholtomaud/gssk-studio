/** Run results as CSV (FR-RES-004): one row per sample, one column per series. */
import type { RunResult } from '../sim/run.ts';

function cell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function resultCsv(r: RunResult): string {
  const header = ['t', ...r.nodes.map((n) => n.id), ...r.flows.map((f) => `flow:${f.id}`)];
  const lines = [header.map(cell).join(',')];
  for (let i = 0; i < r.times.length; i++) {
    const row = [
      r.times[i],
      ...r.nodes.map((n) => n.values[i]),
      ...r.flows.map((f) => f.values[i]),
    ];
    lines.push(row.map((v) => (v === undefined || !Number.isFinite(v) ? '' : String(v))).join(','));
  }
  return `${lines.join('\n')}\n`;
}
