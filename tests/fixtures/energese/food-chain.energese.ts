/**
 * A hand-written Energese script (ADR 0009): a generator, not the model. It
 * builds a four-level food chain in a loop; its synthesized `.gssk.json` is
 * the model. Positions are left to the layout (FR-SDK-005).
 */
import * as ener from '../../../src/sdk/energese/index.ts';

const m = new ener.Model('Four-level food chain', { tEnd: 100, dt: 0.1, method: 'rk4' });
const sun = new ener.Source(m, 'Sun', { value: 100 });
const heat = new ener.HeatSink(m, 'Heat');

let below: ener.NodeRef = sun;
for (let level = 1; level <= 4; level++) {
  const here = new ener.Storage(m, `Level ${level}`, { value: 10 / level });
  new ener.Flow(m, below, here, level === 1 ? ener.linear(0.05) : ener.interaction(0.002, here));
  new ener.Flow(m, here, heat, ener.linear(0.02 * level));
  below = here;
}

export default m;
