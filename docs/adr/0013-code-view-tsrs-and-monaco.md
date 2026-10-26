# ADR 0013 — The code view: tsrs and Monaco, self-hosted and loaded on demand

**Status**: accepted (M8). Deviates from ADR 0001 (no third-party runtime code).

## Context

ADR 0011 makes TypeScript a builder of the model. Writing it well needs an editor that checks
types, and running it needs a TypeScript compiler in the browser. Writing either in-house is out
of proportion. tsrs-monaco already does both: Monaco Editor, and `@tsrs/wasm` (a Rust port of the
TypeScript 7 compiler) type-checking and emitting in a worker, with the emitted modules run in a
second worker.

ADR 0001 allows no third-party runtime code. Both are large: Monaco's editor is about 0.9 MB of
JavaScript gzipped, and `tsrs.wasm` is 9.8 MB (2.9 MB gzipped).

## Decision

Allow exactly two runtime dependencies, for the code view only:

- **`monaco-editor` 0.57.0 and `@tsrs/wasm` 0.18.0-ts7.1.0-dev.20260929**, exact versions in
  `package.json`, their content pinned by the lockfile's integrity hashes, and upgraded only in
  their own PRs. `dompurify`, which Monaco 0.57.0 pulls in at a version with published advisories,
  is overridden to 3.4.17; `npm audit --omit=dev` is clean.
- **Self-hosted**: bundled and served from the studio's own origin, never a CDN.
- **Loaded on demand**: the code view, Monaco, tsrs and their workers build into `assets/code/`.
  They are fetched the first time someone opens the code view, and the service worker caches them
  then. They are not precached, and they are not part of the first-load budget (NFR-PERF-001).
  They have a budget of their own (NFR-PERF-003).
- **Ported, not shared yet**: the compiler worker, the module linker, diagnostics mapping and
  Monaco set-up are ported from tsrs-monaco (MIT, same author) into `src/code/`,
  `src/workers/` and `src/app/monaco.ts`. They move to a shared package when tsrs-monaco adopts
  it (ADR 0012).
- **Only Monaco's core editor and TypeScript highlighting** are loaded, not Monaco's TypeScript
  service. Every diagnostic comes from tsrs. tsrs has no language service, so there is no
  type-aware completion or hover yet.

The script sandbox:

- A script is compiled against the SDK's declaration files (`src/code/sdk-types.json`, generated
  by `npm run sdk:types` and checked by the unit tests). Its `lib` is ES2022 plus `console`, so
  `fetch` and the DOM are type errors.
- It runs in a **fresh worker started from a Blob URL**. A Blob-URL worker inherits the page's
  Content-Security-Policy, so `connect-src 'self'` and `script-src 'self' blob:` stop it from
  fetching or importing anything from another origin. An e2e test proves it: a script that imports
  a URL it computes at run time is blocked with reason `csp`, and nothing reaches the network. The
  policy gains `blob:` in `script-src` and `worker-src` for this. A blob must be created by script
  already running on the page, so this widens nothing an attacker could reach from outside.
- The linker accepts only relative imports and the bare specifiers `energese` and
  `@gssk/builder`. Both resolve to the worker's own copy of the SDK, so the script's `Model` is the
  class the worker checks with `instanceof`. The worker also stubs `fetch`, `XMLHttpRequest`,
  `WebSocket` and `EventSource`, which is the only guard in development, where there is no CSP.
- A script runs once, to produce a document, and is stopped after 10 s. **It never runs inside
  the integration loop.** Rate laws the kernel lacks are kernel requests, not callbacks.

## Consequences

- The studio gains a typed, checked code view without a build server, and the first load is
  unchanged (58.5 kB of JS gzipped).
- Two pinned upstreams and one override to track.
- The CSP now allows `blob:` scripts and workers.
- Completion and hover wait on a tsrs language service or an in-house one.
