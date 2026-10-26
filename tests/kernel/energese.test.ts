import { beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { normaliseModel } from '../../src/model/io.ts';
import { cloneModel } from '../../src/model/types.ts';
import * as ener from '../../src/sdk/energese/index.ts';
import { toEnergese } from '../../src/sdk/energese/codegen.ts';
import type { GsskKernel } from '../../src/sim/gssk.ts';
import { runModel } from '../../src/sim/run.ts';
import foodChain from '../fixtures/energese/food-chain.energese.ts';
import { loadKernel } from './helpers.ts';

let kernel: GsskKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

function runScript(code: string): ener.Model {
  const body = code
    .replace(/^import \* as ener from .*;$/m, '')
    .replace(/^export default m;$/m, 'return m;');
  return new Function('ener', body)(ener) as ener.Model;
}

describe('Energese models on the kernel (FR-SDK-003)', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id}: the model built from its code is the same run`, async () => {
      const model = normaliseModel(cloneModel(ex.model)).model;
      const built = runScript(toEnergese(model)).synth();
      const [a, b] = [await runModel(kernel, model), await runModel(kernel, built)];
      expect(b.manifest.modelHash).toBe(a.manifest.modelHash);
      expect(b.final).toEqual(a.final);
    });
  }

  it('runs a hand-written script cleanly', async () => {
    const r = await runModel(kernel, foodChain.synth());
    expect(r.diagnostics.solverConfident).toBe(true);
    expect(r.final.level_4).toBeGreaterThan(0);
  });
});
