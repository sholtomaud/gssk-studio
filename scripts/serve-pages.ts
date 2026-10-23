#!/usr/bin/env node
/**
 * Serve a built site the way GitHub Pages does, for the e2e tests:
 *
 * - only under the base path (/<repo>/);
 * - a directory serves its index.html;
 * - a missing file is a real 404, answered with the site's 404.html (the
 *   app shell, so deep links still load the app, as on Pages).
 *
 * `vite preview` instead answers every missing path with index.html and
 * status 200, which hides missing assets (a 404 favicon, a page that loads
 * /src/main.ts).
 *
 * Usage: node scripts/serve-pages.ts <dir> <base> <port>
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const [dirArg = 'site', base = '/', portArg = '4173'] = process.argv.slice(2);
const root = resolve(dirArg);
const port = Number(portArg);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** The file for a URL path under the base, or null (outside the base or the site). */
function fileFor(pathname: string): string | null {
  if (!pathname.startsWith(base)) return null;
  let rel = decodeURIComponent(pathname.slice(base.length));
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) return null;
  if (existsSync(file) && statSync(file).isDirectory()) {
    const index = join(file, 'index.html');
    return existsSync(index) ? index : null;
  }
  return existsSync(file) ? file : null;
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const file = fileFor(pathname);
  const notFound = join(root, '404.html');
  const [status, path] = file
    ? [200, file]
    : existsSync(notFound) && pathname.startsWith(base)
      ? [404, notFound]
      : [404, null];
  if (!path) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(status, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(path).pipe(res);
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}${base}`));
