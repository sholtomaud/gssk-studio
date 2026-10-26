# GSSK Studio — Specification

GSSK Studio is a local-first, browser-based editor and simulator for energy-systems models drawn
in Howard T. Odum's Energy Systems Language. A model is drawn as sources, storages, producers,
consumers, work gates and flows; the diagram **is** the model; and the pinned GSSK WebAssembly
kernel integrates it in the browser.

It is the professional successor to [gssk-dia](https://github.com/energese-project/gssk-dia), and
it is built to the same standard as [budget-app](https://github.com/sholtomaud/budget-app): a
written specification with requirement IDs, architecture decisions as ADRs, no third-party runtime
code, a SHA-256-pinned kernel, and CI that tests the build that ships.

Requirement IDs (`FR-…` functional, `NFR-…` non-functional) are cited in code, tests, commits and
PRs. Deviations from this document are recorded as ADRs in [docs/adr/](docs/adr/).

## 1. Purpose

Systems ecologists, energy analysts, educators and students need to sketch a system in Odum's
symbols, run it, and see how its storages and flows behave over time. They need to trust the
numbers, share the model as a file, and come back to it later. gssk-dia proved the idea; GSSK
Studio makes it dependable.

### 1.1 What changes from gssk-dia

| Concern      | gssk-dia                                                                                       | GSSK Studio                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Symbols      | 12 drawn, folded onto 4 kernel primitives before running, so a producer ran as a plain storage | Each of the 12 symbols is a native kernel type (§5.2); producers and consumers run as the kernel's composites                        |
| Code         | One 2,100-line inline module plus a 1,400-line JS component                                    | TypeScript (strict), one folder per component, DOM-free logic in plain modules with unit tests                                       |
| Kernel       | `github:sholtomaud/GSSK#dist`, unpinned, on the UI thread                                      | Vendored, SHA-256 pinned, verified before instantiation, run in a worker (§15)                                                       |
| Dependencies | `@google/genai`, `ajv`, `zod`, `jspdf`                                                         | None at runtime (ADR 0001)                                                                                                           |
| Network      | API key in `localStorage`, Gemini calls, live data polling                                     | No egress at all in v1; any future service is opt-in, per call, behind a CSP allow-list (§13)                                        |
| Undo         | None                                                                                           | Full undo/redo history (FR-EDIT-007)                                                                                                 |
| Validation   | A boolean "invalid" banner                                                                     | Named, located problems with fixes, and the kernel's own refusal shown verbatim (§10)                                                |
| Fitness      | R² against nearest samples; the "p-value" was `1 − R²`                                         | Planned with correct statistics and stated assumptions (§11)                                                                         |
| Provenance   | None                                                                                           | Every run carries a manifest: kernel version and hash, canonical model hash, method, step, sample count (FR-SIM-003)                 |
| Tests        | Playwright on the preview server                                                               | Vitest (unit and real-kernel), Playwright against the production build served as GitHub Pages serves it, privacy test, bundle budget |

### 1.2 Non-goals (v1)

- A server. There is no account, no backend and no telemetry.
- Editing the kernel. Kernel gaps are worked around in the app and filed upstream (§17).
- Collaborative real-time editing.
- An LLM that writes model numbers (NFR-HON-002).

## 2. Principles

1. **The diagram is the model.** What is drawn is what runs; nothing is silently simplified.
2. **The kernel is the authority.** The app's checks explain; the kernel decides. A kernel refusal
   is shown as it was given.
3. **Local first.** Models live in the browser and in files the user owns (NFR-PRIV-001).
4. **Honest numbers.** Every result says how it was produced (NFR-HON-001).
5. **Deterministic.** The same model on the same kernel gives the same numbers (NFR-DET-001).
6. **Accessible.** Every action has a keyboard path and an accessible name (NFR-A11Y-001).

## 3. Users and use cases

- **Modeller**: draws a system, sets rates, runs, compares runs, exports the model and its results.
- **Educator**: opens an example, plays it back to a class, changes one rate and runs again.
- **Analyst**: loads observed data and measures fit (M3); calibrates rates, runs ensembles (M4–M5).

## 4. Architecture

```
 UI thread                                         sim worker
 ┌──────────────────────────────────────┐          ┌───────────────────────────┐
 │ library-page   studio-page           │   RPC    │ verify gssk.wasm vs pin   │
 │                 ├ diagram-canvas     │ ───────▶ │ GSSK_Init(kernel JSON)    │
 │                 ├ inspector-panel    │ ◀─────── │ step t_start → t_end      │
 │                 └ results-panel      │  result  │ sample ≤ 2000 points      │
 │ src/model (pure) · src/store (IDB)   │          │ manifest + diagnostics    │
 └──────────────────────────────────────┘          └───────────────────────────┘
```

- Components are Boba-style custom elements (ADR 0001): markup, styles and logic per component,
  light DOM, data rendered with `textContent` and DOM APIs only.
- All model logic is in DOM-free modules under `src/model/`, `src/diagram/`, `src/sim/` and
  `src/viz/`, unit-tested in Node.
- The UI never touches WebAssembly memory. `src/sim/gssk.ts` owns every pointer.

## 5. The model document

### 5.1 Shape (FR-MOD-001)

A model is one JSON document that is a valid GSSK Schema v4 model (ADR 0003):

```json
{
  "metadata": { "schema_version": 4, "name": "Grassland food chain" },
  "config": { "t_start": 0, "t_end": 200, "dt": 0.1, "method": "rk4" },
  "nodes": [
    {
      "id": "sun",
      "type": "source",
      "value": 100,
      "visual": { "x": 100, "y": 260, "label": "Sunlight" }
    },
    {
      "id": "grass",
      "type": "producer",
      "value": 20,
      "visual": { "x": 330, "y": 260, "label": "Grass", "capacity": 200 }
    }
  ],
  "edges": [
    {
      "id": "photosynthesis",
      "origin": "sun",
      "target": "grass",
      "logic": "linear",
      "params": { "k": 0.02 }
    }
  ],
  "_diagram": {
    "boundaries": [{ "id": "pasture", "x": 220, "y": 150, "w": 480, "h": 420, "label": "Pasture" }]
  }
}
```

- `nodes`, `edges`, `config`, `metadata` are read by the kernel.
- `visual` on nodes and edges, and the root `_diagram` block, are editor-only; the kernel schema
  ignores both (`visual` is declared free-form, `_`-prefixed keys are ignored everywhere).
- Files use the extension `.gssk.json` (FR-IO-001).

### 5.2 Symbol catalogue (FR-MOD-002)

One symbol per kernel node type. `src/model/catalogue.ts` is the only table of node semantics.

| Symbol (Odum 1983) | Kernel type    | Holds state     | Notes                                                                                 |
| ------------------ | -------------- | --------------- | ------------------------------------------------------------------------------------- |
| Source             | `source`       | no              | Held at its value                                                                     |
| Storage (tank)     | `storage`      | yes             | dQ/dt = inflows − outflows                                                            |
| Heat sink          | `sink`         | yes             | Accumulates degraded energy                                                           |
| Constant           | `constant`     | no              | Not in the palette: a source does the same job; imported constants still draw and run |
| Producer           | `producer`     | yes (composite) | Expands to body, gate, heat; charted by its body                                      |
| Consumer           | `consumer`     | yes (composite) | Expands to body, heat                                                                 |
| Interaction        | `interaction`  | no              | Multiplicative work gate                                                              |
| Transaction        | `exchange`     | no              | Goods one way, money the other, at a price or price node                              |
| Switch             | `switch`       | no              | On/off around a threshold                                                             |
| Amplifier          | `gain`         | no              | Constant-gain amplifier                                                               |
| Receiver           | `loop_limited` | no              | k·Q/(1+Q/C)                                                                           |
| Box                | `misc_box`     | yes (composite) | A subsystem not drawn in detail                                                       |

Flow logics are the kernel's: `linear`, `constant`, `interaction`, `limit`, `threshold`, `ratio`,
`reversible`, `subtract`, each with the parameters the kernel requires (§10).

### 5.3 Boundaries (FR-MOD-003)

A boundary is a labelled dashed region drawn beneath the nodes. It is never sent to the kernel.

## 6. Editor (FR-EDIT)

- **FR-EDIT-001** Palette: every palette symbol, plus Boundary and Sensor. Click places the symbol
  at the free grid spot nearest the viewport centre, preferring one in view, and pans just enough
  to show it; drag places it where dropped.
- **FR-EDIT-002** Select, move (grid 10), delete (Delete/Backspace), nudge (arrows, Shift ×5).
- **FR-EDIT-003** Wire: drag from a node's port onto another node to add a flow; onto a flow to
  make the node that flow's control, turning it into an interaction with a drawn work gate.
  Self-loops and duplicate flows are refused.
- **FR-EDIT-004** Shape: a selected flow shows two Bézier handles; "Straighten curve" removes them.
- **FR-EDIT-005** Inspector: properties of the selection or, with nothing selected, of the model
  and its run settings. Renaming an id rewrites every reference to it.
- **FR-EDIT-006** View: pan (drag empty canvas, wheel), zoom (Ctrl/⌘-wheel, buttons), fit.
- **FR-EDIT-007** Undo/redo (Ctrl/⌘-Z, Ctrl/⌘-Shift-Z, Ctrl/⌘-Y), 200 steps; a drag or a run of
  keystrokes in one field is one step.
- **FR-EDIT-008** Autosave to the library 400 ms after the last edit; "Saved" is shown only after
  the write commits.
- **FR-EDIT-009** Symbols draw identically in every browser: each SVG shape carries its own
  paint, because page CSS does not reliably reach the shadow copy a `<use>` renders.
- **FR-EDIT-010** Sensor (Odum's small box on a pathway): a flow can carry a sensor, placed by
  dragging the palette's Sensor onto the flow, by selecting the flow and clicking Sensor, or from
  the inspector. It reads the flow's rate J without taking from it: during playback it shows J,
  and the run offers the flow as a chart series. It does not change the model the kernel runs
  (`visual.sensor`), and it cannot yet drive a control (K-5).
- **FR-EDIT-011** Several symbols: Shift-click adds or removes one; Shift-drag on empty canvas
  selects by marquee; Ctrl/⌘-A selects all. A selection moves, nudges and deletes together.
  Ctrl/⌘-C, -X, -V and -D copy, cut, paste and duplicate it with the flows between its symbols,
  under fresh ids; a control outside the copy keeps pointing at the original while it exists.
- **FR-EDIT-012** Align (left, centre, right, top, middle, bottom) and distribute (horizontally,
  vertically) several symbols from the inspector.

## 7. Simulation (FR-SIM)

### 7.1 Kernel JSON

`toKernelModel` strips everything the kernel does not read. A control reference to a composite is
rewritten to the composite's state member (`{id}__body`, `{id}__box`), working around K-1 (§17).

### 7.2 Runs

- **FR-SIM-001** Run integrates `t_start → t_end` with fixed steps in the sim worker and records at
  most 2,000 samples per series (the final state exactly), plus every flow (Odum J).
- **FR-SIM-002** A run blocked by an error-level check does not reach the kernel; a kernel refusal
  is reported with its status name.
- **FR-SIM-003** Every run carries a manifest: kernel version and SHA-256, SHA-256 of the canonical
  kernel JSON (layout-independent), method, dt, steps, samples, elapsed time.
- **FR-SIM-004** Diagnostics: dual-solver confidence and the count of steps the kernel warned
  `GSSK_WARN_SOLVER_DIVERGENCE`; the result says "Solver diverged" if any.
- **FR-SIM-005** Long runs advance in the worker in ~120 ms chunks: the results panel shows
  progress, Run becomes Cancel, and a cancel takes effect at the next chunk and frees the
  kernel instance. Starting a run closes any other run in the worker.

## 8. Results (FR-RES)

- **FR-RES-001** A time-series chart on one shared y-axis; series coloured by entity from the
  validated eight-slot palette; at most eight at once; storages charted by default, heat sinks off.
- **FR-RES-002** Hover crosshair with a tooltip of every charted value; direct end labels when four
  or fewer series are drawn; a table view of the same numbers.
- **FR-RES-003** Playback: a time scrubber and play button drive the diagram — readings under each
  label and storage gauges. A **Flow widths** toggle (off by default, remembered) also draws each
  flow as wide as |J| relative to the run's largest flow, a Sankey-style reading.
- **FR-RES-004** CSV download of every sample, node and flow.
- **FR-RES-005** A result older than the model is marked "Model changed since this run".
- **FR-RES-006** Compare: keep a run as a baseline; later runs draw it dashed in each series'
  colour (dash as the second encoding), over the current run's time range, and the tooltip
  gives the baseline value beside the current one. The baseline lasts for the session.

## 9. Library and files (FR-LIB, FR-IO)

- **FR-LIB-001** The library lists the user's models (IndexedDB) with a drawn thumbnail; open,
  duplicate, export, delete (with confirmation).
- **FR-LIB-002** Five examples, each opened as a copy: grassland food chain (producer, consumer,
  work gate), predator–prey, reservoir (limit logic), household money, resource economy.
- **FR-IO-001** Export writes the model as `.gssk.json`, loadable by `GSSK_Init` as-is (except K-1).
- **FR-IO-002** Import accepts a studio file, a plain kernel model, or a gssk-dia export.
- **FR-IO-003** Import never silently changes a model: each change is listed under Checks
  (ADR 0006).
- **FR-IO-004** Export the diagram as SVG or PNG (2×): a standalone picture with the theme's
  colours written in, without editing chrome (ports, handles, selection).

## 10. Validation (FR-VAL)

- **FR-VAL-001** On every edit: errors (missing endpoints, duplicate or unusable ids, a logic
  missing its control or threshold, non-numeric values, a non-positive step, an end before the
  start, more than 500,000 steps) and warnings (isolated symbols, flows into a source, flows out of
  a heat sink, long composite ids). Each names and links to the node or flow at fault.

## 11. Observations and fitness (M3)

- **FR-OBS-001** Import observed series from CSV (Observations, in the inspector with nothing
  selected): model time in the first column, one series per column, a heading row; comma,
  semicolon or tab separated, RFC 4180 quoting. A heading matching a node's id or label (case and
  punctuation ignored), or a sensed flow's id, is compared with it; others stay unmapped until a
  target is picked. Series live in the model's `_observations` (never sent to the kernel), follow
  renames, and lose their target when it is deleted. A non-numeric time names its row.
- **FR-OBS-002** Observations are drawn over the series they measure as hollow markers in its
  colour (hollow vs line as the second encoding), with a "○ observed" key.
- **FR-FIT-001** Fit view in Results: for each compared series, the run is linearly interpolated
  at each observation time inside the run (others are counted and left out), and the panel shows
  n, RMSE, MAE, bias (sim − obs), NSE (Nash–Sutcliffe), KGE (Kling–Gupta, Gupta et al. 2009) and
  r² (squared Pearson correlation), with their definitions. None is a significance test, so no
  p-value is shown (gssk-dia's `1 − R²` was not one).
- The Reservoir example carries synthetic gauge readings (the run with a fixed ±4 % pattern).

## 12. Calibration, sensitivity and ensembles

### 12.1 Calibration (M4, FR-CAL-001)

- **Calibrate rates…** (Results → Fit) fits chosen flow rates k to the compared observations. Rates
  on flows into or out of an observed symbol are pre-selected.
- Least squares over θ = ln k, so rates stay positive. Each series' residuals are divided by that
  series' spread, so series in different units weigh alike. Solved by Levenberg–Marquardt, with a
  forward-difference Jacobian where every evaluation is a real run on the pinned kernel
  (ADR 0008). It runs in the worker with progress and Cancel.
- The result shows each rate before and after, a linearised standard error (σ²(JᵀJ)⁻¹, stated as
  indicative), rates the data do not inform (left unchanged), NSE and RMSE before and after, the
  stopping reason and the number of kernel runs. Nothing changes until **Apply rates**, which is
  one undoable edit; applied rates are rounded to six significant figures.

### 12.2 Sensitivity (M4, FR-SEN-001)

- **Sensitivity to rates** (Results) gives, for each charted series and each rate, the elasticity
  ∂ln y / ∂ln k of the series' mean over the run (and of its final value, on hover). Central
  differences at k × (1 ± 1 %) on real kernel runs; local to the current rates. Rates are sorted by
  their strongest effect.

### 12.3 Ensembles and forcing (M5, planned)

- **FR-ENS-001** Ensembles from `GSSK_EnsembleForecast` with an explicit seed (NFR-DET-001),
  drawn as min–max envelopes around the mean.
- **FR-FRC-001** Forcing functions (step, ramp, sine, table …) on sources and edges, previewed with
  `GSSK_EvaluateNodeForcing` so the drawn curve is the simulated one.

## 13. External services (M6, opt-in, planned)

- **NFR-PRIV-003** No silent network. v1 makes no request outside its own origin; the build's CSP
  is `connect-src 'self'`, and an e2e test asserts no foreign request.
- A future service (a live data source, an AI write-up of a run) must be enabled by the user,
  consented per call, listed in the CSP at build time, and its key held in memory or encrypted at
  rest — never in plain `localStorage`.
- **NFR-HON-002** An LLM may describe a run; it never produces or alters a number.

## 14. Storage and security

- **NFR-PRIV-001** Models are stored in this browser's IndexedDB and in files the user exports.
- **NFR-PRIV-002** No real observation data or private models are committed; `data/` and `private/`
  are git-ignored.
- **NFR-STO-001** IndexedDB schema changes are additive, versioned migrations.
- **NFR-STO-005** Works offline after the first load (service worker precaches every built file,
  including `gssk.wasm`).

## 15. Technology and kernel

- TypeScript 7 strict, erasable syntax only, explicit `.ts` imports; Vite 8; Vitest; Playwright.
- **NFR-KER-001** GSSK is vendored in `vendor/gssk/` from
  `energese-project/GSSK-Giannantoni@dist`, pinned by commit and SHA-256 in `GSSK_PIN.json` (the
  same pin as budget-app, ADR 0002). The worker hashes the wasm before instantiating it and refuses
  a mismatch. Never edit `vendor/gssk/`; upgrade with `npm run gssk:update -- <dist-commit>` in its
  own PR.

## 16. Quality

- **Tests**: unit (model operations, checks, import/export, kernel JSON, geometry, scales, history,
  routes); kernel (every example and every symbol on the real kernel, determinism, snapshots of
  final states, pin refusal, K-1 status); e2e against the production build (shell, studio
  workflows, files, privacy, kernel self-test).
- **NFR-PERF-001** First-load JS ≤ 400 kB gzipped, excluding wasm (`npm run bundle-size`).
- **NFR-PERF-002** The studio adds at most 10 % to the kernel's own stepping time for a run
  (sampling, manifest, diagnostics). Measured at M1: a 20-node chain, 100,000 Euler steps, 6.2 s
  in `runModel` against 6.4 s for the bare `GSSK_Step` loop — the cost is the kernel's (K-4).
- **NFR-A11Y-001** Palette, symbols and controls are keyboard-reachable buttons with accessible
  names; the chart has a table view; status is never colour alone.
- **CI** runs lint, typecheck, unit and kernel tests, the GSSK pin check, the build, the bundle
  budget and e2e against the built site served under `/<repo>/`.
- **Deployment**: GitHub Pages from the CI artefact on every push to `main` after build, test
  and e2e pass, and only while Pages' source is "GitHub Actions".

## 17. Kernel requests to GSSK (non-blocking)

- **K-1** `GSSK_Init` resolves a composite named as an edge end to its port, but rejects one named
  as `params.control_node` with `GSSK_ERR_SCHEMA_VIOLATION`. Request: resolve a composite control to
  its state member. Workaround: `toKernelModel` names the member (`tests/kernel/kernel.test.ts`
  pins the current behaviour and will fail when the kernel changes).
- **K-2** In `auto` mode, models with composites or limit logic return
  `GSSK_WARN_SOLVER_DIVERGENCE` on most steps. Request: document when the dual solver is expected to
  disagree, and expose why. Workaround: the examples use `rk4`; the result reports diverged steps.
- **K-3** `GSSK_GetErrorDescription` needs an instance, so an init failure has no message beyond
  its status. Request: an instance-free last-error string.
- **K-4** Per-step cost grows roughly with the square of the node count even under `euler`
  (pinned 5.3.0, Node 22: 1 storage ≈ 2 µs/step, 18 ≈ 64 µs, 50 ≈ 250 µs). Request: profile the
  per-step passes (quality accounting, reclassification) and skip those a model does not use.
  Until then long runs need progress and cancel (M2).
- **K-5** A control can read only a node's level Q. Odum's sensor reads a flow's rate J and
  drives a control from it (a flow-controlled switch or gate). Request: let `params.control_node`
  (or a new `params.control_edge`) name an edge whose current J is the control value.
  Until then a sensor displays and charts J only (FR-EDIT-010).
- **K-6** `GSSK_CalibrateGradient` returns success but stops far from the optimum: on the
  reservoir example, from rates 50 % off it halves the misfit and halts at the same wrong point
  after 50 or 500 iterations, where the app's own Levenberg–Marquardt over kernel runs recovers
  the true rates to three significant figures. Its forward sensitivity is Euler-integrated while
  the run uses `rk4`, which may give a gradient that does not match the model as run. Its
  observations also cross the boundary as C structs, which bakes wasm32 field offsets into the
  caller. Request: a gradient consistent with the run's method, and flat setters for
  observations. Until then calibration is in the app (ADR 0008).

## 18. Repository layout

See [AGENTS.md](AGENTS.md#layout).

## 19. Milestones

| ID  | Scope                                                                                                    | Status      |
| --- | -------------------------------------------------------------------------------------------------------- | ----------- |
| M0  | Foundation: spec, ADRs, pinned kernel in a worker, app shell, CI, offline, CSP                           | done        |
| M1  | Editor and runs: palette, wiring, gates, boundaries, inspector, checks, undo, results, playback          | done        |
| M2  | Run progress and cancel, multi-select, copy/paste, align, SVG/PNG diagram export, run comparison, sensor | done        |
| M3  | Observations and fitness (§11)                                                                           | done        |
| M4  | Calibration and sensitivity (§12)                                                                        | done        |
| M5  | Forcing functions and ensembles (§12)                                                                    | planned     |
| M6  | Opt-in services: live data sources, AI run write-up, report/PDF export (§13)                             | planned     |
| M7  | Hierarchy: archetypes and nested sub-models (kernel Schema v4 `archetypes`)                              | exploratory |

## 20. Open questions

1. Should the studio offer the kernel's adaptive DOPRI5 stepping (`GSSK_StepAdaptive`) as a method?
2. Units: carriers declare units in the kernel schema; should the chart split axes by unit
   (small multiples) rather than sharing one?
3. Is "Receiver" the right Odum name for `loop_limited`, or should it be "Self-limiting receptor"?

## 21. Glossary

- **Q** — a node's quantity (state). **J** — a flow's rate. **k** — an edge's rate coefficient.
- **Work gate** — Odum's interaction symbol on a flow: the flow is multiplied by its control's Q.
- **Composite** — a node type the kernel expands into several members at load.
- **Manifest** — the record of how a run was produced.
