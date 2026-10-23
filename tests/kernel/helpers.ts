import { readFileSync } from 'node:fs';
import { GsskKernel, type GsskPin } from '../../src/sim/gssk.ts';

export const root = new URL('../../', import.meta.url);
export const pin = JSON.parse(
  readFileSync(new URL('vendor/gssk/GSSK_PIN.json', root), 'utf8')
) as GsskPin;

export function wasmBytes(): ArrayBuffer {
  const buf = readFileSync(new URL('vendor/gssk/gssk.wasm', root));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export function loadKernel(): Promise<GsskKernel> {
  return GsskKernel.load(wasmBytes(), pin);
}
