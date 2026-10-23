/**
 * GSSK's WebAssembly loader, as a dependency-free ES module.
 *
 *   import createGSSK from './gssk.js';
 *   const gssk = await createGSSK();            // loads ./gssk.wasm beside this file
 *   const p = gssk._malloc(n); gssk.stringToUTF8(json, p, n); gssk._GSSK_Init(p, out);
 *
 * gssk.wasm is the C99 kernel compiled by clang for wasm32-wasip1 as a
 * "reactor": a library with no main(). This file is the whole of its
 * JavaScript side. It replaced Emscripten's generated glue, and keeps the
 * shape consumers already used — `_GSSK_*` functions, `_malloc`/`_free`,
 * the HEAP views and three string helpers — so code written against the
 * Emscripten build only changes how it imports the factory.
 *
 * It is hand-written and short on purpose. An archived kernel must stay
 * runnable when today's toolchains are gone, and this file, gssk.wasm and a
 * standards-conforming JavaScript engine are everything that takes.
 */

// The four WASI calls wasi-libc makes on GSSK's behalf. GSSK's own code reads
// no clock and opens no files; these come from libc's stdio and startup.
const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_INVAL = 28;
const ERRNO_SPIPE = 70;
const CLOCK_REALTIME = 0;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @param {object} [options]
 * @param {URL|string|BufferSource|Response|WebAssembly.Module} [options.wasm]
 *   The kernel. Defaults to gssk.wasm in the same directory as this module.
 * @param {(line: string) => void} [options.print]     stdout, one call per line
 * @param {(line: string) => void} [options.printErr]  stderr, one call per line
 */
export default async function createGSSK(options = {}) {
  const {
    wasm = new URL('./gssk.wasm', import.meta.url),
    print = (line) => console.log(line),
    printErr = (line) => console.error(line),
  } = options;

  const module = await compile(wasm);
  let memory = null;
  const imports = { wasi_snapshot_preview1: wasi(() => memory, { 1: print, 2: printErr }) };

  // Refuse at load, by name, rather than when a call first reaches the import.
  const missing = WebAssembly.Module.imports(module)
    .filter(({ module: m, name }) => !(imports[m] && name in imports[m]))
    .map(({ module: m, name }) => `${m}.${name}`);
  if (missing.length) {
    throw new Error(`gssk.wasm needs host imports this loader does not provide: ${missing.join(', ')}`);
  }

  const { exports } = await WebAssembly.instantiate(module, imports);
  memory = exports.memory;
  exports._initialize?.();

  const gssk = {};
  for (const [name, value] of Object.entries(exports)) {
    if (typeof value === 'function' && name !== '_initialize') gssk[`_${name}`] = value;
  }

  // Views over linear memory. memory.grow() replaces the buffer and detaches
  // every view on the old one, so they are rebuilt whenever the buffer changes.
  let views = { buffer: null };
  const heap = () => {
    if (views.buffer !== memory.buffer) {
      const b = memory.buffer;
      views = { buffer: b, u8: new Uint8Array(b), u32: new Uint32Array(b), f64: new Float64Array(b) };
    }
    return views;
  };
  Object.defineProperties(gssk, {
    memory:  { value: memory, enumerable: true },
    HEAPU8:  { get: () => heap().u8, enumerable: true },
    HEAPU32: { get: () => heap().u32, enumerable: true },
    HEAPF64: { get: () => heap().f64, enumerable: true },
  });

  /** The NUL-terminated UTF-8 string at ptr. A null pointer reads as ''. */
  gssk.UTF8ToString = (ptr) => {
    if (!ptr) return '';
    const u8 = heap().u8;
    const end = u8.indexOf(0, ptr);
    return decoder.decode(u8.subarray(ptr, end < 0 ? u8.length : end));
  };

  /** Bytes str occupies as UTF-8, without the terminator. */
  gssk.lengthBytesUTF8 = (str) => encoder.encode(str).length;

  /**
   * Write str at ptr as UTF-8, NUL-terminated, in at most maxBytes bytes
   * including the terminator. Never splits a multi-byte character.
   */
  gssk.stringToUTF8 = (str, ptr, maxBytes) => {
    if (maxBytes <= 0) return;
    const u8 = heap().u8;
    const { written } = encoder.encodeInto(str, u8.subarray(ptr, ptr + maxBytes - 1));
    u8[ptr + written] = 0;
  };

  return gssk;
}

async function compile(source) {
  if (source instanceof WebAssembly.Module) return source;
  if (ArrayBuffer.isView(source) || source instanceof ArrayBuffer) return WebAssembly.compile(source);
  if (typeof Response !== 'undefined' && source instanceof Response) return compileResponse(source);

  const url = new URL(source, import.meta.url);
  if (url.protocol === 'file:') {
    // Node, Deno and Bun: fetch() does not read file: URLs everywhere yet.
    const { readFile } = await import('node:fs/promises');
    return WebAssembly.compile(await readFile(url));
  }
  return compileResponse(await fetch(url));
}

async function compileResponse(response) {
  if (!response.ok) throw new Error(`gssk.wasm: HTTP ${response.status} for ${response.url}`);
  // Streaming compilation needs the application/wasm type; fall back when a server omits it.
  if (response.headers.get('content-type')?.startsWith('application/wasm')) {
    return WebAssembly.compileStreaming(response);
  }
  return WebAssembly.compile(await response.arrayBuffer());
}

/** wasi_snapshot_preview1, to the extent wasi-libc uses it for this kernel. */
function wasi(getMemory, sinks) {
  // One streaming decoder per stream, so a character split across two writes
  // survives and stdout bytes can never complete a character on stderr.
  const decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
  const pending = { 1: '', 2: '' };
  const data = () => new DataView(getMemory().buffer);

  return {
    fd_write(fd, iovs, iovsLen, nwrittenPtr) {
      const sink = sinks[fd];
      if (!sink) return ERRNO_BADF;
      const view = data();
      const u8 = new Uint8Array(getMemory().buffer);
      let total = 0;
      let text = '';
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view.getUint32(iovs + i * 8, true);
        const len = view.getUint32(iovs + i * 8 + 4, true);
        text += decoders[fd].decode(u8.subarray(ptr, ptr + len), { stream: true });
        total += len;
      }
      const lines = (pending[fd] + text).split('\n');
      pending[fd] = lines.pop();
      for (const line of lines) sink(line);
      view.setUint32(nwrittenPtr, total, true);
      return ERRNO_SUCCESS;
    },
    fd_close() {
      return ERRNO_SUCCESS;
    },
    fd_seek() {
      return ERRNO_SPIPE; // stdout and stderr are streams
    },
    clock_time_get(id, _precision, timePtr) {
      if (id < 0 || id > 3) return ERRNO_INVAL;
      const ns = id === CLOCK_REALTIME
        ? BigInt(Date.now()) * 1_000_000n
        : BigInt(Math.round(performance.now() * 1e6));
      data().setBigUint64(timePtr, ns, true);
      return ERRNO_SUCCESS;
    },
  };
}
