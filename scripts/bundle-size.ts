#!/usr/bin/env node
/**
 * Performance budgets. NFR-PERF-001: first-load JS ≤ 400 kB gzipped,
 * excluding wasm. Counts every emitted .js file outside assets/code/
 * (workers and lazy screens included), so it over-counts first load and is
 * conservative. NFR-PERF-003: the code view (ADR 0011), loaded on demand
 * from assets/code/, ≤ 1,100 kB of JS gzipped, excluding tsrs.wasm.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const FIRST_LOAD_LIMIT = 400 * 1024;
const CODE_VIEW_LIMIT = 1100 * 1024;
const dir = process.argv[2] ?? 'dist';

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(dir).filter((f) => f.endsWith('.js') && !f.endsWith('sw.js'));
if (files.length === 0) {
  console.error(`No JS found in ${dir}/. Run the build first.`);
  process.exit(1);
}
const isCode = (f: string) => relative(dir, f).split(sep).join('/').startsWith('assets/code/');

let failed = false;
for (const [label, group, limit] of [
  ['first-load JS', files.filter((f) => !isCode(f)), FIRST_LOAD_LIMIT],
  ['code view JS', files.filter(isCode), CODE_VIEW_LIMIT],
] as const) {
  let total = 0;
  for (const f of group) {
    const gz = gzipSync(readFileSync(f), { level: 9 }).length;
    total += gz;
    console.log(`${(gz / 1024).toFixed(1).padStart(8)} kB  ${f}`);
  }
  console.log(
    `${(total / 1024).toFixed(1).padStart(8)} kB  ${label} (gzip), limit ${limit / 1024} kB\n`
  );
  if (total > limit) {
    console.error(`Bundle-size budget exceeded: ${label}.`);
    failed = true;
  }
}
if (failed) process.exit(1);
