# AGENTS.md

The canonical contribution standard for GSSK Studio, for people and AI agents alike. `SPEC.md` is
the requirements document. Cite its IDs (`FR-…`, `NFR-…`, `K-…`) in commits, PRs and tests.

## Non-negotiables

1. **The diagram is the model** (ADR 0003). Every palette symbol is a native kernel type. Never
   fold, approximate or silently rewrite what the user drew; when a kernel gap forces a rewrite,
   do it in `src/model/kernel-json.ts`, test it, and file it in SPEC §17.
2. **No silent network** (NFR-PRIV-003). No third-party scripts, analytics or runtime CDN loads.
   The build's CSP is `connect-src 'self'`. An e2e test asserts it.
3. **GSSK is pinned and unmodified** (NFR-KER-001). Never edit `vendor/gssk/`. Upgrade with
   `npm run gssk:update -- <dist-commit>` in its own PR.
4. **Every number has a provenance** (NFR-HON-001): a run's manifest says which kernel, which
   model hash, which method and step. **An LLM never produces a number** (NFR-HON-002).
5. **Deterministic** (NFR-DET-001): every stochastic step takes an explicit seed.
6. **No real data in the repository** (NFR-PRIV-002). Fixtures are synthetic.
7. **Spec deviations are ADRs** in `docs/adr/`.

## Layout

| Path                  | What                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/core/`       | Boba-style `BaseComponent` and `Router` (shared with budget-app).                                                                               |
| `src/app/components/` | One folder per custom element: `.ts`, `.css`, and `.html` where the markup is static.                                                           |
| `src/model/`          | The model document: types, symbol catalogue, edit operations, checks, history, import/export, kernel JSON, examples.                            |
| `src/code/`           | The code view's DOM-free parts: the virtual project, the SDK's declaration files, diagnostics, module linking, running a script (ADR 0013).     |
| `src/sdk/`            | `gssk/`, the domain-neutral model builder; `energese/`, Odum's symbols as constructs, and code generation (ADR 0012). Never imports `src/app/`. |
| `src/diagram/`        | Odum symbols as SVG and the geometry of anchors and Bézier flows.                                                                               |
| `src/sim/`            | `gssk.ts`, the only code that touches WASM memory; `run.ts`, a whole run with sampling, manifest and diagnostics.                               |
| `src/viz/`            | Chart scales, series colour slots, results CSV.                                                                                                 |
| `src/store/`          | IndexedDB with versioned migrations; the model library.                                                                                         |
| `src/workers/`        | `sim.worker.ts` and the in-house RPC. The UI never touches WASM directly.                                                                       |
| `src/sw/sw.js`        | Service-worker template; the build fills in the precache list.                                                                                  |
| `vendor/gssk/`        | Pinned kernel and `GSSK_PIN.json`.                                                                                                              |
| `tests/unit`          | Vitest, DOM-free logic.                                                                                                                         |
| `tests/kernel`        | Vitest against the real pinned kernel.                                                                                                          |
| `tests/e2e`           | Playwright against the production build, served the way GitHub Pages serves it.                                                                 |
| `tests/fixtures`      | Synthetic model files.                                                                                                                          |
| `scripts/`            | GSSK verify and update, bundle size, the Pages-like static server.                                                                              |
| `docs/adr/`           | Architecture decisions.                                                                                                                         |

## Conventions

- TypeScript strict, **erasable syntax only** (no `enum`, no parameter properties, no
  namespaces), explicit `.ts` import extensions. Source runs unchanged in Node and Vite.
- Components render data with DOM APIs and `textContent`, never by interpolating data into HTML.
  Static markup (symbol definitions, icons) may use `innerHTML`.
- Components never own the model. They propose edits as `diagram-edit` events carrying a new
  model built by `src/model/ops.ts`; `studio-page` keeps history and saves.
- Model operations return a new model and never mutate their input.
- Keep logic that needs no DOM in plain modules so it is unit-testable.
- Colours are role tokens in `src/styles/global.css`, with dark mode as its own steps. Chart
  series use the eight validated slots, assigned by entity, never cycled.
- Prettier formats everything; `tsc` is the linter.
- **No third-party runtime dependencies** (ADR 0001), except `monaco-editor` and `@tsrs/wasm`
  for the code view (ADR 0013): exact versions, loaded on demand from `assets/code/`. Anything
  else: write it in-house, or propose an ADR.
- After changing `src/sdk/`, run `npm run sdk:types` (the compiler's copy of the SDK's types)
  and, if the generated code changed, `UPDATE_ENERGESE=1 npx vitest run tests/unit/energese.test.ts`.
- Scripts are TypeScript (`scripts/*.ts`) run directly by Node.

## Before every push

```bash
npm ci
npm run lint        # Prettier check
npm run typecheck
npm test            # unit and kernel tests (Vitest)
npm run gssk:verify
npm run build && npm run bundle-size
npm run e2e         # needs Playwright's Chromium: npx playwright install chromium
```

All must pass. CI runs the same on every PR.

## Workflow

Work on a feature branch, one milestone (SPEC §19) or smaller per PR, with green CI.

- **Always work from a branch.** Never commit or push to `main`; changes reach `main` only by a
  merged PR.
- **Never force-push** (no `--force`, no `--force-with-lease`), and never rewrite pushed history
  (no rebase, amend or reset of commits already on the remote). To bring a branch up to date,
  merge `main` into it, or fast-forward it when it holds only merged history.
- The author does not merge their own PR. A task is done when it is merged and, for anything
  user-facing, when the deployed page has been checked.
