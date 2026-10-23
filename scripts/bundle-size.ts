#!/usr/bin/env node
/**
 * Performance budget (NFR-PERF-001): first-load JS ≤ 400 kB gzipped, excluding
 * wasm. Counts every emitted .js file (workers and lazy screens included), so
 * it over-counts first load and is conservative.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT = 400 * 1024;
const dir = process.argv[2] ?? 'dist';

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(dir).filter((f) => f.endsWith('.js') && !f.endsWith('sw.js'));
let total = 0;
for (const f of files) {
  const gz = gzipSync(readFileSync(f), { level: 9 }).length;
  total += gz;
  console.log(`${(gz / 1024).toFixed(1).padStart(8)} kB  ${f}`);
}
console.log(
  `${(total / 1024).toFixed(1).padStart(8)} kB  total JS (gzip), limit ${LIMIT / 1024} kB`
);
if (files.length === 0) {
  console.error(`No JS found in ${dir}/. Run the build first.`);
  process.exit(1);
}
if (total > LIMIT) {
  console.error('Bundle-size budget exceeded (NFR-PERF-001).');
  process.exit(1);
}
