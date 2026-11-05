import { beforeAll, describe, expect, it } from 'vitest';
import {
  blockFromGroup,
  blockHash,
  parseBlock,
  placeBlock,
  serialiseBlock,
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
});
