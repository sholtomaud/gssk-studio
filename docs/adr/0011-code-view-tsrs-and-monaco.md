# ADR 0011 — The code view: tsrs and Monaco, self-hosted and loaded on demand

**Status**: proposed (M8). Deviates from ADR 0001 (no third-party runtime code).

## Context

ADR 0009 makes TypeScript a builder of the model. Writing it well needs an editor with types and
completion, and running it needs a TypeScript compiler in the browser. Writing either in-house is
out of proportion. tsrs-monaco already does both: Monaco Editor, and `@tsrs/wasm` (a Rust port of
the TypeScript 7 compiler) type-checking and emitting in a worker, with the emitted modules run in
a second worker.

ADR 0001 allows no third-party runtime code. Both are large: Monaco is several MB, tsrs's wasm and
`lib.*.d.ts` files more.

## Decision

Allow exactly two runtime dependencies, for the code view only:

- `monaco-editor` and `@tsrs/wasm`, pinned to exact versions and SHA-256s, **bundled and served
  from the studio's own origin** (no CDN; the CSP stays `script-src 'self'`).
- **Loaded only when the code view opens** (a dynamic import), so the first-load budget
  (NFR-PERF-001) is unchanged; cached by the service worker after first use.
- The editor component comes from tsrs-monaco, reworked as a reusable custom element.
- Scripts run in a worker with no DOM and no network. The worker maps the bare specifier
  `energese` (and `@gssk/builder`) to the bundled SDK, and gives tsrs the SDK's `.d.ts`. A script's
  default export is a `GsskModel`; the worker posts back `synth()`'s JSON, never a function.
- Scripts never run inside the integration loop: there is no per-step callback into JavaScript.
  Custom rate laws are kernel requests (an expression language), not JS hooks.

## Consequences

- The studio gains a typed, checked code view without a build server.
- Two pinned upstreams to track; upgrades are their own PRs, like the kernel's.
- Until this ADR is accepted, the code view is read-only: the generated form (FR-SDK-002), with
  copy and export as `.energese.ts`.
