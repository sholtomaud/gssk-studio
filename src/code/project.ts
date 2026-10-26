/**
 * The virtual project the code view compiles (ADR 0011): one script, the
 * SDK's declaration files as `node_modules/energese` and
 * `node_modules/@gssk/builder`, and a fixed tsconfig. The project's `lib` is
 * the language alone plus `console`: a script has no DOM and no network, and
 * its types say so.
 */
import sdkTypes from './sdk-types.json' with { type: 'json' };

export const PROJECT_ROOT = '/project';
export const SCRIPT = 'src/model.energese.ts';
/** Where tsrs writes the script's JavaScript. */
export const SCRIPT_JS = 'dist/model.energese.js';
/** The only bare specifiers a script may import. */
export const SDK_MODULES = ['energese', '@gssk/builder'] as const;

export type ProjectFiles = Record<string, string>;

export const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: 'es2022',
      module: 'esnext',
      moduleResolution: 'bundler',
      lib: ['es2022'],
      types: [],
      strict: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      rootDir: 'src',
      outDir: 'dist',
    },
    include: ['src'],
  },
  null,
  2
)}\n`;

const GLOBALS = `/** The script sandbox: console only (ADR 0011). */
declare const console: {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
`;

/** Every file tsrs is given for a check, keyed by absolute path. */
export function projectFiles(script: string): ProjectFiles {
  const files: ProjectFiles = {
    'tsconfig.json': TSCONFIG,
    'src/globals.d.ts': GLOBALS,
    [SCRIPT]: script,
    ...(sdkTypes as ProjectFiles),
  };
  return Object.fromEntries(Object.entries(files).map(([p, t]) => [toAbsolute(p), t]));
}

export function toAbsolute(path: string): string {
  return `${PROJECT_ROOT}/${path}`;
}

export function toRelative(path: string): string {
  const prefix = `${PROJECT_ROOT}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
