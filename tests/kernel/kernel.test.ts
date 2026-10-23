import { beforeAll, describe, expect, it } from 'vitest';
import { GsskKernel, PinMismatchError } from '../../src/sim/gssk.ts';
import { serialiseModel } from '../../src/model/io.ts';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { symbolFor } from '../../src/model/catalogue.ts';
import { toKernelModel } from '../../src/model/kernel-json.ts';
import type { StudioModel } from '../../src/model/types.ts';

function usesCompositeControl(m: StudioModel): boolean {
  const composite = new Set(m.nodes.filter((n) => symbolFor(n.type).composite).map((n) => n.id));
  return m.edges.some(
    (e) => e.params.control_node !== undefined && composite.has(e.params.control_node)
  );
}
import { loadKernel, pin, wasmBytes } from './helpers.ts';

let kernel: GsskKernel;
beforeAll(async () => {
  kernel = await loadKernel();
});

describe('the pinned kernel (NFR-KER-001)', () => {
  it('loads and reports the pinned version', () => {
    expect(kernel.info.version).toBe(pin.version);
    expect(kernel.info.sha256).toBe(pin.sha256['gssk.wasm']);
  });

  it('refuses a kernel whose bytes do not match the pin', async () => {
    const bytes = new Uint8Array(wasmBytes().slice(0));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    await expect(GsskKernel.load(bytes.buffer, pin)).rejects.toBeInstanceOf(PinMismatchError);
  });

  it('loads a saved studio file as-is: the diagram is the model (ADR 0003)', () => {
    for (const ex of EXAMPLES.filter((e) => !usesCompositeControl(e.model))) {
      const inst = kernel.init(serialiseModel(ex.model));
      expect(inst.nodeIds.length, ex.id).toBeGreaterThanOrEqual(ex.model.nodes.length);
      inst.free();
    }
  });

  // Kernel request K-1 (SPEC §17). When this starts failing, the kernel resolves
  // a composite named as a control: drop the rewrite in kernel-json.ts and this test.
  it('still refuses a composite named as a control (K-1 open)', () => {
    const grassland = EXAMPLES.find((e) => e.id === 'grassland')!;
    expect(usesCompositeControl(grassland.model)).toBe(true);
    expect(() => kernel.init(serialiseModel(grassland.model))).toThrow(/SCHEMA_VIOLATION/);
    const inst = kernel.init(JSON.stringify(toKernelModel(grassland.model)));
    inst.free();
  });
});
