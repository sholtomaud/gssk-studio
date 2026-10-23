# ADR 0001 — Build on budget-app's foundation

**Status**: accepted (M0)

## Context

gssk-dia is a working prototype: a 1,400-line web component and a 2,100-line inline module in
`index.html`, with `@google/genai`, `ajv`, `zod` and `jspdf` at runtime. It has no unit tests and no
separation between model logic and DOM. budget-app, by the same author, already solved the
foundation this project needs: a Boba-style component base, a router that works under a GitHub
Pages subpath, a typed worker RPC, a pinned and verified GSSK kernel, a CSP, offline support, and
CI that tests the build that ships.

## Decision

Start GSSK Studio from budget-app's foundation rather than refactoring gssk-dia in place:

- copy `BaseComponent`, `Store`, `Router`, the worker RPC, the GSSK wrapper, the service-worker
  template, the Pages-like static server and the GSSK scripts, then adapt them;
- TypeScript strict with erasable syntax only, run unchanged by Node and Vite;
- **no third-party runtime dependencies**. The schema validation `ajv`/`zod` did is replaced by
  `src/model/io.ts` and `src/model/validate.ts`, which check exactly what the kernel needs and say
  where the problem is; PDF and Gemini are deferred (ADR 0005).

## Consequences

- The two apps share idioms, so a fix in one ports to the other.
- Everything rendered is ours to maintain, including the editor and chart (ADR 0007).
- gssk-dia's Odum symbol geometry (translated from `tikz-odum.sty`) is reused as data.
