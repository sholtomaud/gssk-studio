import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * The code view (ADR 0013) — Monaco, tsrs and their workers — loads on demand.
 * Its files go under assets/code/, so the first-load budget and the precache
 * leave them out; the service worker caches them when first used.
 */
const CODE_DIR = 'assets/code';
const CODE =
  /monaco-editor|@tsrs|\/src\/code\/|code-view|code-client|\/src\/app\/monaco\.ts|(compiler|script)\.worker/;
const inCode = (ids: readonly string[]) => ids.some((id) => CODE.test(id));
const jsName = (ids: readonly string[]) =>
  inCode(ids) ? `${CODE_DIR}/[name]-[hash].js` : 'assets/[name]-[hash].js';
const output = {
  entryFileNames: (c: { facadeModuleId: string | null; name: string }) =>
    jsName([c.facadeModuleId ?? c.name]),
  chunkFileNames: (c: { moduleIds: string[] }) => jsName(c.moduleIds),
  assetFileNames: (a: { names: string[]; originalFileNames: string[] }) =>
    inCode(a.originalFileNames) || a.names.some((n) => /^(code-view|tsrs|codicon)\b/.test(n))
      ? `${CODE_DIR}/[name]-[hash][extname]`
      : 'assets/[name]-[hash][extname]',
};

/**
 * NFR-PRIV-003: the built page talks only to its own origin. A meta CSP
 * cannot be widened at runtime, so a future opt-in API (SPEC §13) must add
 * its origin here, in review. Dev builds skip the policy because Vite's dev
 * client needs a websocket.
 */
const CSP = [
  "default-src 'self'",
  // blob: lets the script worker start from a Blob URL, so that it inherits
  // this policy, and import the script's own modules (ADR 0013).
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'gssk-studio:csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`
      );
    },
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]
  );
}

/**
 * NFR-STO-005: after the build, write a service worker that precaches every
 * emitted file (including gssk.wasm), and a 404.html so static hosts serve
 * the app shell for deep links.
 */
function offline(): Plugin {
  let outDir = 'dist';
  return {
    name: 'gssk-studio:offline',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      writeFileSync(join(outDir, '404.html'), readFileSync(join(outDir, 'index.html')));
      const files = listFiles(outDir)
        .map((f) => relative(outDir, f).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith(`${CODE_DIR}/`))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 16);
      const template = readFileSync('src/sw/sw.js', 'utf8');
      if (!template.includes('const PRECACHE = __PRECACHE__;')) {
        throw new Error('src/sw/sw.js: precache placeholder missing');
      }
      writeFileSync(
        join(outDir, 'sw.js'),
        template
          .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(files)};`)
          .replace('const VERSION = __VERSION__;', `const VERSION = ${JSON.stringify(version)};`)
      );
    },
  };
}

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [csp(), offline()],
  worker: { format: 'es', rolldownOptions: { output } },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
    rolldownOptions: { output },
    // Monaco's core is one large chunk, loaded only with the code view.
    chunkSizeWarningLimit: 3500,
  },
  // @tsrs/wasm finds tsrs.wasm relative to its own module URL.
  optimizeDeps: { exclude: ['@tsrs/wasm'] },
  server: { fs: { allow: ['.'] } },
  test: {
    include: ['tests/{unit,kernel}/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
