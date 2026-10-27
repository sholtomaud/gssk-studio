/**
 * Links a script's emitted modules into URLs the runtime can import, after
 * tsrs-monaco (MIT). Blob and data URLs have no path, so every module becomes
 * a URL in dependency order, with its relative imports rewritten to its
 * dependencies' URLs and its SDK imports to the SDK's. Any other import is
 * refused: a script reaches nothing but the SDK and its own files (ADR 0013).
 */

const SPECIFIER =
  /(\bimport\s*\(\s*|\bimport\s+|\bfrom\s*|\bexport\s*\*\s*from\s*)(['"])([^'"\n]+)\2/g;

const isRelative = (spec: string) => spec.startsWith('./') || spec.startsWith('../');

export type Modules = Record<string, string>;

export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkError';
  }
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function joinPath(base: string, rel: string): string {
  const parts = base ? base.split('/') : [];
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/** `spec` imported from `from`, as a key of `modules`, or null. */
export function resolveSpecifier(modules: Modules, from: string, spec: string): string | null {
  const base = joinPath(dirname(from), spec);
  for (const candidate of [base, `${base}.js`, `${base}/index.js`]) {
    if (candidate in modules) return candidate;
  }
  return null;
}

/**
 * The entry's URL, after turning each module it reaches into a URL with
 * `toUrl`, dependencies first. `external` maps the bare specifiers allowed.
 */
export function link(
  modules: Modules,
  entry: string,
  toUrl: (path: string, code: string) => string,
  external: Readonly<Record<string, string>>
): string {
  const urls = new Map<string, string>();
  const visiting = new Set<string>();

  const visit = (path: string, chain: string[]): string => {
    const done = urls.get(path);
    if (done) return done;
    if (visiting.has(path)) {
      throw new LinkError(`Circular imports are not supported: ${[...chain, path].join(' → ')}`);
    }
    visiting.add(path);
    const code = modules[path]!.replace(
      SPECIFIER,
      (_match, prefix: string, quote: string, spec: string) => {
        if (!isRelative(spec)) {
          const url = external[spec];
          if (!url) {
            throw new LinkError(
              `A script can import ${Object.keys(external).join(' and ')} and its own files, not “${spec}”.`
            );
          }
          return `${prefix}${quote}${url}${quote}`;
        }
        const target = resolveSpecifier(modules, path, spec);
        if (!target) throw new LinkError(`Cannot find module “${spec}” from “${path}”.`);
        return `${prefix}${quote}${visit(target, [...chain, path])}${quote}`;
      }
    );
    visiting.delete(path);
    const url = toUrl(path, code);
    urls.set(path, url);
    return url;
  };

  if (!(entry in modules)) throw new LinkError(`The script “${entry}” was not emitted.`);
  return visit(entry, []);
}
