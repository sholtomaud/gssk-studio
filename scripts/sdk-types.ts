#!/usr/bin/env node
/**
 * The SDK's declaration files for the code view's compiler (ADR 0013):
 * `tsc --emitDeclarationOnly` over `src/sdk/`, laid out as the packages a
 * script imports, `@gssk/builder` and `energese`, and written to
 * `src/code/sdk-types.json`. Run after changing the SDK; `--check` (in the
 * unit tests) fails when the file is out of date.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(root, 'src/code/sdk-types.json');
const BUILDER = 'node_modules/@gssk/builder';

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

export function sdkTypes(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'gssk-sdk-types-'));
  try {
    const out = join(tmp, 'out');
    const config = join(tmp, 'tsconfig.json');
    writeFileSync(
      config,
      JSON.stringify({
        extends: join(root, 'tsconfig.json'),
        compilerOptions: {
          noEmit: false,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: out,
          rootDir: join(root, 'src'),
          types: [],
        },
        include: [],
        files: [join(root, 'src/sdk/energese/index.ts'), join(root, 'src/sdk/gssk/builder.ts')],
      })
    );
    execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', config], { stdio: 'inherit' });
    const files: Record<string, string> = {
      [`${BUILDER}/package.json`]: `${JSON.stringify({ name: '@gssk/builder', types: './sdk/gssk/builder.d.ts' })}\n`,
      'node_modules/energese/package.json': `${JSON.stringify({ name: 'energese', types: './index.d.ts' })}\n`,
      'node_modules/energese/index.d.ts':
        "export * from '../@gssk/builder/sdk/energese/index.js';\n",
    };
    for (const f of walk(out).sort()) {
      files[`${BUILDER}/${relative(out, f).split(sep).join('/')}`] = readFileSync(f, 'utf8');
    }
    return `${JSON.stringify(files, null, 2)}\n`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = sdkTypes();
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== text) {
      console.error('src/code/sdk-types.json is out of date: run npm run sdk:types');
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${relative(root, OUT)}`);
  }
}
