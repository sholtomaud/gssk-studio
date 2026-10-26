/**
 * Local sensitivity of a model's series to its rates (FR-SEN-001): the
 * elasticity ∂ln y / ∂ln k, by central differences (k × (1 ± 1 %)) on real
 * kernel runs. An elasticity of 0.5 means a 1 % rise in k raises y by about
 * 0.5 %. Two summaries of each series: its time-mean and its final value.
 */
import { cloneModel, type StudioModel } from '../model/types.ts';
import type { GsskKernel } from '../sim/gssk.ts';
import { trajectories } from './calibrate.ts';

export interface Elasticity {
  edgeId: string;
  target: string;
  /** Of the series' mean over the run. */
  mean: number;
  /** Of its final value. */
  final: number;
}

const H = 0.01;

function summary(v: Float64Array): { mean: number; final: number } {
  let s = 0;
  for (const x of v) s += x;
  return { mean: s / v.length, final: v[v.length - 1] ?? NaN };
}

const elastic = (up: number, down: number, base: number) =>
  base !== 0 && Number.isFinite(up) && Number.isFinite(down) ? (up - down) / (2 * H * base) : NaN;

export function elasticities(
  kernel: GsskKernel,
  model: StudioModel,
  targets: readonly string[]
): Elasticity[] {
  const base = trajectories(kernel, model, targets);
  const b = new Map(targets.map((t) => [t, summary(base.series.get(t) ?? new Float64Array())]));
  const out: Elasticity[] = [];
  for (const e of model.edges) {
    if (!(e.params.k > 0)) continue;
    const at = (f: number) => {
      const m = cloneModel(model);
      const x = m.edges.find((y) => y.id === e.id);
      if (x) x.params.k = e.params.k * f;
      return trajectories(kernel, m, targets);
    };
    const up = at(1 + H);
    const down = at(1 - H);
    for (const t of targets) {
      const u = summary(up.series.get(t) ?? new Float64Array());
      const d = summary(down.series.get(t) ?? new Float64Array());
      const s = b.get(t) ?? { mean: NaN, final: NaN };
      out.push({
        edgeId: e.id,
        target: t,
        mean: elastic(u.mean, d.mean, s.mean),
        final: elastic(u.final, d.final, s.final),
      });
    }
  }
  return out;
}
