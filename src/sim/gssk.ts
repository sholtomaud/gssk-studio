/**
 * Typed wrapper over the vendored GSSK kernel (SPEC §15).
 *
 * This module owns every pointer: string marshalling, the GSSK_Init
 * out-pointer, HEAPF64 state views and freeing. Nothing else in the app
 * touches WASM memory.
 */
import createGSSK, { type GSSKModule } from '../../vendor/gssk/gssk.js';

export interface GsskPin {
  repo: string;
  branch: string;
  commit: string;
  tag: string | null;
  version: string;
  sha256: Record<string, string>;
}

/** GSSK_Status, from vendor/gssk/gssk.h. */
const STATUS_NAMES = [
  'GSSK_SUCCESS',
  'GSSK_ERR_INVALID_JSON',
  'GSSK_ERR_MALLOC_FAILED',
  'GSSK_ERR_SCHEMA_VIOLATION',
  'GSSK_ERR_DIVERGENCE',
  'GSSK_ERR_NOT_FOUND',
  'GSSK_ERR_UNSUPPORTED_SCHEMA_VERSION',
  'GSSK_ERR_UNKNOWN',
  'GSSK_WARN_SOLVER_DIVERGENCE',
] as const;

/** A status that reports a completed step, not a failure. */
const WARN_SOLVER_DIVERGENCE = STATUS_NAMES.indexOf('GSSK_WARN_SOLVER_DIVERGENCE');

export class GsskError extends Error {
  readonly status: number;
  constructor(op: string, status: number, detail = '') {
    const name = STATUS_NAMES[status] ?? `status ${status}`;
    super(`${op} failed: ${name}${detail ? ` (${detail})` : ''}`);
    this.name = 'GsskError';
    this.status = status;
  }
}

export class PinMismatchError extends Error {
  constructor(file: string, expected: string, actual: string) {
    super(`${file} SHA-256 mismatch: pinned ${expected}, loaded ${actual}. Refusing to run.`);
    this.name = 'PinMismatchError';
  }
}

export async function sha256Hex(data: BufferSource | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface KernelInfo {
  version: string;
  sha256: string;
  pin: GsskPin;
}

export class GsskKernel {
  readonly info: KernelInfo;
  readonly module: GSSKModule;

  private constructor(module: GSSKModule, info: KernelInfo) {
    this.module = module;
    this.info = info;
  }

  /**
   * Verify the wasm bytes against the pin, then instantiate. Refuses to run on
   * mismatch (NFR-KER-001).
   */
  static async load(wasm: ArrayBuffer, pin: GsskPin): Promise<GsskKernel> {
    const expected = pin.sha256['gssk.wasm'];
    if (!expected) throw new Error('GSSK_PIN.json has no sha256 for gssk.wasm');
    const actual = await sha256Hex(wasm);
    if (actual !== expected) throw new PinMismatchError('gssk.wasm', expected, actual);

    const module = await createGSSK({
      wasm,
      print: () => {},
      printErr: (line) => console.warn(`[gssk] ${line}`),
    });
    const version = module.UTF8ToString(module._GSSK_GetVersionString());
    if (version !== pin.version) {
      throw new Error(`gssk.wasm reports version ${version}, pin says ${pin.version}`);
    }
    return new GsskKernel(module, { version, sha256: actual, pin });
  }

  /** GSSK_Init on a model JSON string. The caller must free() the instance. */
  init(modelJson: string): GsskInstance {
    const m = this.module;
    const out = m._malloc(4);
    try {
      const status = this.withString(modelJson, (p) => m._GSSK_Init(p, out));
      const inst = m.HEAPU32[out >>> 2] ?? 0;
      if (status !== 0 || inst === 0) throw new GsskError('GSSK_Init', status);
      return new GsskInstance(this, inst);
    } finally {
      m._free(out);
    }
  }

  /**
   * GSSK_Replay: a fresh instance from the initial model, stepped to targetT
   * with the exported mutation log applied.
   */
  replay(modelJson: string, mutationLogJson: string, targetT: number): GsskInstance {
    const m = this.module;
    const out = m._malloc(4);
    try {
      const status = this.withString(modelJson, (pModel) =>
        this.withString(mutationLogJson, (pLog) => m._GSSK_Replay(pModel, pLog, targetT, out))
      );
      const inst = m.HEAPU32[out >>> 2] ?? 0;
      if (status !== 0 || inst === 0) throw new GsskError('GSSK_Replay', status);
      return new GsskInstance(this, inst);
    } finally {
      m._free(out);
    }
  }

  /** @internal Copy str into the heap as NUL-terminated UTF-8 for the call. */
  withString<T>(str: string, fn: (ptr: number) => T): T {
    const m = this.module;
    const n = m.lengthBytesUTF8(str) + 1;
    const p = m._malloc(n);
    if (p === 0) throw new GsskError('malloc', 2);
    try {
      m.stringToUTF8(str, p, n);
      return fn(p);
    } finally {
      m._free(p);
    }
  }

  /** @internal Read and free a kernel-allocated string returned through an out-pointer. */
  takeString(op: string, fn: (outPtr: number) => number): string {
    const m = this.module;
    const out = m._malloc(4);
    try {
      const status = fn(out);
      const p = m.HEAPU32[out >>> 2] ?? 0;
      if (status !== 0 || p === 0) throw new GsskError(op, status);
      try {
        return m.UTF8ToString(p);
      } finally {
        m._GSSK_FreeString(p);
      }
    } finally {
      m._free(out);
    }
  }
}

export class GsskInstance {
  private readonly kernel: GsskKernel;
  private ptr: number;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly carrierIds: readonly string[];

  constructor(kernel: GsskKernel, ptr: number) {
    this.kernel = kernel;
    this.ptr = ptr;
    const m = kernel.module;
    this.nodeIds = Array.from({ length: m._GSSK_GetStateSize(ptr) }, (_, i) =>
      m.UTF8ToString(m._GSSK_GetNodeID(ptr, i))
    );
    this.edgeIds = Array.from({ length: m._GSSK_GetEdgeCount(ptr) }, (_, i) =>
      m.UTF8ToString(m._GSSK_GetEdgeID(ptr, i))
    );
    this.carrierIds = Array.from({ length: m._GSSK_GetCarrierCount(ptr) }, (_, i) =>
      m.UTF8ToString(m._GSSK_GetCarrierID(ptr, i))
    );
  }

  private get p(): number {
    if (this.ptr === 0) throw new Error('GSSK instance used after free()');
    return this.ptr;
  }

  get tStart(): number {
    return this.kernel.module._GSSK_GetTStart(this.p);
  }
  get tEnd(): number {
    return this.kernel.module._GSSK_GetTEnd(this.p);
  }
  get dt(): number {
    return this.kernel.module._GSSK_GetDt(this.p);
  }
  get time(): number {
    return this.kernel.module._GSSK_GetCurrentTime(this.p);
  }
  get stepCount(): number {
    return this.kernel.module._GSSK_GetStepCount(this.p);
  }

  /**
   * One fixed step. Returns true when the kernel took the step but warned that
   * its solvers diverged (GSSK_WARN_SOLVER_DIVERGENCE); throws on any error.
   */
  step(dt = this.dt): boolean {
    const status = this.kernel.module._GSSK_Step(this.p, dt);
    if (status === WARN_SOLVER_DIVERGENCE) return true;
    if (status !== 0) throw new GsskError('GSSK_Step', status, `t=${this.time}`);
    return false;
  }

  reset(): void {
    this.kernel.module._GSSK_Reset(this.p);
  }

  /** A copy of the state vector (one value per node, in nodeIds order). */
  state(): Float64Array {
    const m = this.kernel.module;
    const base = m._GSSK_GetState(this.p) >>> 3;
    return m.HEAPF64.slice(base, base + this.nodeIds.length);
  }

  nodeIndex(id: string): number {
    const i = this.nodeIds.indexOf(id);
    if (i < 0) throw new GsskError('node lookup', 5, id);
    return i;
  }

  edgeIndex(id: string): number {
    const i = this.edgeIds.indexOf(id);
    if (i < 0) throw new GsskError('edge lookup', 5, id);
    return i;
  }

  carrierIndex(id: string): number {
    const i = this.carrierIds.indexOf(id);
    if (i < 0) throw new GsskError('carrier lookup', 5, id);
    return i;
  }

  getEdgeK(edgeId: string): number {
    return this.kernel.module._GSSK_GetEdgeK(this.p, this.edgeIndex(edgeId));
  }

  /**
   * Set an edge rate. `cause` is recorded in the mutation log first, so every
   * rate change in a run says why it happened (NFR-HON-001).
   */
  setEdgeK(edgeId: string, k: number, cause: string): void {
    const idx = this.edgeIndex(edgeId);
    const m = this.kernel.module;
    this.kernel.withString(cause, (p) => m._GSSK_SetMutationCause(this.p, p));
    m._GSSK_SetEdgeK(this.p, idx, k);
  }

  /** A copy of the per-edge flow vector (Odum J), in edgeIds order; 0 before the first step. */
  flows(): Float64Array {
    const m = this.kernel.module;
    const base = m._GSSK_GetFlows(this.p) >>> 3;
    return m.HEAPF64.slice(base, base + this.edgeIds.length);
  }

  /** Copy the flow vector into `out` without allocating. */
  flowsInto(out: Float64Array): Float64Array {
    const m = this.kernel.module;
    const base = m._GSSK_GetFlows(this.p) >>> 3;
    out.set(m.HEAPF64.subarray(base, base + out.length));
    return out;
  }

  /** The composite instance that owns node `index`; '' if it was declared directly. */
  nodeComposite(index: number): string {
    const m = this.kernel.module;
    return m.UTF8ToString(m._GSSK_GetNodeComposite(this.p, index));
  }

  /** The node's role in its archetype ("body", "gate", "heat"); '' if none. */
  nodeRole(index: number): string {
    const m = this.kernel.module;
    return m.UTF8ToString(m._GSSK_GetNodeRole(this.p, index));
  }

  /** Dual-solver agreement (auto mode): true while the solvers agree within tolerance. */
  solverConfident(): boolean {
    return this.kernel.module._GSSK_GetSolverConfidence(this.p) === 0;
  }

  /** Relative total-Q change over the last step. */
  conservationError(): number {
    return this.kernel.module._GSSK_GetConservationError(this.p);
  }

  /** Copy the state vector into `out` without allocating. */
  stateInto(out: Float64Array): Float64Array {
    const m = this.kernel.module;
    const base = m._GSSK_GetState(this.p) >>> 3;
    out.set(m.HEAPF64.subarray(base, base + out.length));
    return out;
  }

  clearMutationLog(): void {
    this.kernel.module._GSSK_ClearMutationLog(this.p);
  }

  carrierConservationError(carrierId: string): number {
    return this.kernel.module._GSSK_GetCarrierConservationError(
      this.p,
      this.carrierIndex(carrierId)
    );
  }

  carrierConserved(carrierId: string): boolean {
    return this.kernel.module._GSSK_GetCarrierConserved(this.p, this.carrierIndex(carrierId)) !== 0;
  }

  mutationCount(): number {
    return this.kernel.module._GSSK_GetMutationCount(this.p);
  }

  exportMutationLog(): string {
    const m = this.kernel.module;
    return this.kernel.takeString('GSSK_ExportMutationLog', (out) =>
      m._GSSK_ExportMutationLog(this.p, out)
    );
  }

  free(): void {
    if (this.ptr !== 0) {
      this.kernel.module._GSSK_Free(this.ptr);
      this.ptr = 0;
    }
  }
}
