import { beforeAll, describe, expect, it } from 'vitest';
import {
  blockFromGroup,
  blockHash,
  parseBlock,
  placeBlock,
  scoreTests,
  serialiseBlock,
  trustLevel,
} from '../../src/model/blocks.ts';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { groupNodes } from '../../src/model/groups.ts';
import { cloneModel, emptyModel } from '../../src/model/types.ts';
import type { GsskKernel } from '../../src/sim/gssk.ts';
import { runModel } from '../../src/sim/run.ts';
import { loadKernel } from './helpers.ts';

let kernel: GsskKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

describe('building blocks run as what they were saved from (ADR 0017)', () => {
  for (const ex of EXAMPLES) {
    it(`the ${ex.id} example, saved whole as a block and placed in an empty model, runs the same`, async () => {
      const m = cloneModel(ex.model);
      const { model, id } = groupNodes(
        m,
        m.nodes.map((n) => n.id),
        'All'
      );
      const { block } = blockFromGroup(model, id!, {
        id: `test.${ex.id}`,
        version: '1.0.0',
        title: ex.id,
      });
      const read = parseBlock(serialiseBlock(block)).block;
      const placed = placeBlock(emptyModel(), read, { x: 0, y: 0 }, await blockHash(read)).model;
      placed.config = { ...m.config };
      const a = await runModel(kernel, m);
      const b = await runModel(kernel, placed);
      // Nothing clashed in an empty model, so the ids are the same.
      expect(b.final).toEqual(a.final);
    });
  }

  it('a block that reproduces its observations is fitted; one that does not only runs', async () => {
    const m = cloneModel(EXAMPLES[0]!.model);
    const r = await runModel(kernel, m);
    const node = r.nodes.find((n) => n.holdsState)!;
    const times = [0, 10, 20, 30, 40, 50].filter((t) => t <= m.config.t_end);
    const at = (t: number) =>
      node.values[Math.round((t - m.config.t_start) / (r.times[1]! - r.times[0]!))]!;
    m._observations = [
      { id: 'obs', name: 'Observed', target: node.id, times, values: times.map(at) },
    ];
    const { model, id } = groupNodes(
      m,
      m.nodes.map((n) => n.id),
      'All'
    );
    const { block } = blockFromGroup(model, id!, {
      id: 'test.fit',
      version: '1.0.0',
      title: 'Fit',
      tests: [{ series: 'obs', metric: 'nse', min: 0.99 }],
    });
    expect(block.tests).toHaveLength(1);
    const b = await runModel(kernel, block.model);
    const series = (t: string) => b.nodes.find((n) => n.id === t)?.values;
    const good = scoreTests(block.tests, b.times, series);
    expect(good[0]!.passed).toBe(true);
    expect(trustLevel({ errors: 0, ran: true, scores: good })).toBe('fitted');
    const off = block.tests.map((t) => ({ ...t, values: t.values.map((v, i) => v * (1 + i)) }));
    const bad = scoreTests(off, b.times, series);
    expect(bad[0]!.passed).toBe(false);
    expect(trustLevel({ errors: 0, ran: true, scores: bad })).toBe('runs');
    expect(trustLevel({ errors: 0 })).toBe('structural');
    expect(trustLevel({ errors: 1, ran: true, scores: good })).toBe('unchecked');
  });
});
