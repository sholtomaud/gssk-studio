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
| Dependencies | `@google/genai`, `ajv`, `zod`, `jspdf`                                                         | None at runtime, except Monaco and tsrs for the code view, loaded on demand (ADR 0001, ADR 0013)                                     |
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
- An LLM that produces results, or sets an input without marking it (NFR-HON-002, ADR 0016).

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
- **Analyst**: loads observed data and measures fit (M3); calibrates rates, forces inputs and runs ensembles (M4–M5).

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

### 5.4 Zoom groups (FR-MOD-004)

A group (`_diagram.groups`) names the symbols packed into it and may sit inside another group. It
is never sent to the kernel (ADR 0010): the run, and its model hash, are the same packed or not.

### 5.5 Energetic types (M13, FR-TYP-001, ADR 0015)

What every store and flow is, named by the standard that governs it, so a diagram can be bound
to real data:

- **Carrier** (Odum's Code; the kernel's `carrier`): a named thing in a model-level carrier
  list, such as electricity, water, a streaming service or AUD.
- **Unit**: a UCUM code (`kW.h`, `kL`, `kg`, `By`, `{subscription}`). **Currency**: an ISO 4217
  code for fiat (AUD, USD) or an ISO 24165 DTI for a crypto-asset (BTC).
- **Kind**: energy, material, information or monetary. It is inferred from the unit or
  currency, and asked for only when the unit cannot tell.
  - Kind sets Odum's line style: solid for energy and material, dashed for monetary, dotted for
    information.
  - Kind sets the default `conserved`: information is not conserved, because copying a stream
    does not use it up.
- **Purpose**: a COICOP 2018 code, the household budget account (04 Housing, water,
  electricity…; 03 Clothing and footwear; 07 Transport; 08 Information and communication). No
  field is called "sector"; in national accounts that word means who, not what.
- **Tags**: free strings on a transaction, for filtering.
- **Editing**: the model's inspector (select nothing) lists its carriers. Each has an id, a name,
  and how it is measured: a UCUM unit, an ISO 4217 currency (from the browser's own ISO 4217
  list, with names), or an ISO 24165 DTI (its shape is checked; the registry is not shipped).
  Presets cover AUD, USD, electricity (kW.h), natural gas (MJ), water (kL), food (kg) and data
  (GBy). Renaming a carrier renames it on everything that carries it. A symbol's or flow's
  Carrier field offers the model's carriers and says what the chosen one measures.
- **Stored** in the kernel's top-level `carriers` list. The kernel reads `id`, `unit` (for
  money, its currency code) and `conserved`; the name, kind, currency and DTI are `_` fields
  (`_label`, `_kind`, `_currency`, `_dti`) until the kernel adopts them (K-9 KX-1, KX-2). A model
  without carriers sends the kernel none, so its model hash is unchanged.
- **Checks** (FR-VAL-001):
  - errors: an unusable or duplicate carrier id; a currency that is not ISO 4217; a DTI of the
    wrong shape; both a currency and a DTI;
  - warnings: a carrier whose kind is unknown (no unit, or one that cannot tell); a symbol or
    flow carrying an id not in the carriers.
  - Not yet: matching an observation's unit to its target's, and a flow's carrier to its ends'.

### 5.6 Transactions (M13, FR-TRX-001)

A transaction is a marking on a **pair of flows** that run opposite ways: something
non-monetary one way, money the other (Odum's ecological-economic convention).

- **Placing**: drag the palette's Transaction onto a flow, as with the sensor (FR-EDIT-010). It
  attaches to that flow and draws the transaction symbol on it.
- **Invalid until complete**: the flow and its transaction glow red (FR-VAL-002) until a
  counter-flow exists. Exactly one of the pair carries a monetary carrier, fiat (ISO 4217) or a
  digital token (ISO 24165), and the other carries a non-monetary one. The message names what is
  missing, and **Add counter-flow** offers to draw the money flow, between money storages it
  proposes or new ones.
- The pair is stored as the kernel's reciprocal `coupled_edge`; the marking, with its purpose
  (COICOP 2018, a division or a finer code) and tags, is `visual.transaction` on the flow it was
  placed on.
- **Drawing** (Odum's convention): the transaction symbol is a plain diamond. The counter-flow
  runs back alongside the marked flow, the opposite way, and one diamond sits across both,
  wherever the counter-flow's ends lie back the way the marked flow came (their directions more
  than about 107° apart). Otherwise, or once its curve is shaped by hand, the counter-flow is
  drawn on its own with a small diamond; **Straighten curve** brings it back alongside. Layout
  only: the kernel model is the same. Taking the transaction off unpairs the flows; deleting either
  flow unpairs the other, whose marking (if any) is invalid again; a copy keeps its pairing only
  when both flows are copied.
- **Add counter-flow** (in the flow's inspector) draws a `constant` money flow, k per unit
  time, between two ends picked from the diagram or new money storages placed beside the
  marked flow, in a declared monetary carrier or an ISO 4217 currency it declares.
- A pairing with no marking (a `coupled_edge` written by hand) is checked too: to a missing flow,
  to itself, or one-way is an error, which the kernel would accept silently (K-10).
- The kernel's `exchange` node, which moves nothing in GSSK 5.3.0, is no longer in the palette.
  Models that have one still load, with a warning that names K-9. In the Energese SDK it is
  `ener.Exchange`; `ener.Transaction` is the marking and `ener.Carrier` a carrier.
- The **Paying for electricity and streaming** example buys electricity (kW.h, COICOP 04) and a
  video stream (GBy, information, COICOP 08) with AUD.
- **Price**: until the kernel supports priced counter-flows (K-9), each flow keeps its own rate.
  The inspector shows the implied price at constant rates (96 AUD ÷ 300 kW.h = 0.32 AUD/kW.h),
  and during playback the diagram shows money J ÷ goods J under each diamond. Once K-9 lands, the
  money flow takes `logic: "price"` with a constant, a price node or a forced price, and payer
  exhaustion stops the purchase.

## 6. Editor (FR-EDIT)

- **FR-EDIT-001** Palette: every palette symbol, plus Boundary and Sensor. Click places the symbol
  at the free grid spot nearest the viewport centre, preferring one in view, and pans just enough
  to show it; drag places it where dropped.
- **FR-EDIT-002** Select, move (grid 10), delete (Delete/Backspace), nudge (arrows, Shift ×5).
- **FR-EDIT-003** Wire: drag from a node's port onto another node to add a flow; onto a flow to
  make the node that flow's control, turning it into an interaction with a drawn work gate.
  Self-loops are refused. A symbol takes any number of flows in and out, and a second flow
  between the same two symbols is a parallel pathway, as Odum draws them: its own logic and
  rate, added by the kernel. Each further parallel flow bows 24 units further out, so all can be
  seen and picked.
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
- **FR-EDIT-013** Turn and size a symbol, as Odum turns an interaction toward its heat sink. A
  single selected symbol shows a knob above it, which turns it in 15° steps (Shift: 1°), and a
  corner square, which sizes it from 50 % to 300 % in 5 % steps; the inspector's **Turn (°)** and
  **Size (%)** fields do the same. Flows attach to the outline as turned and sized (a turned heat
  sink is still entered at its top); labels, gauge and port stay upright. Stored as
  `visual.rotation` (degrees, clockwise) and `visual.scale`, omitted at 0° and 100 %; layout
  only, so neither marks a run out of date, and both round-trip through files and Energese code.
- **FR-EDIT-014** Icon view, as Odum and Odum set EXTEND's icons beside the energy diagram of a
  pond. An **Icons** toggle on the canvas (off by default, remembered) draws each symbol as a
  picture instead of its Energese symbol; flows, labels, gauges and checks are unchanged. Each
  symbol type has a built-in line icon (source a sun, storage a tank, producer a plant…), and the
  symbol's inspector picks another from the built-in set (bank, house, water, electricity,
  factory, people…) or **adds your own picture**: an SVG, PNG, JPEG, WebP or GIF of at most about
  146 KB, read in the browser and kept in the model file as a base64 data URL
  (`_diagram.icons`, `visual.icon`). A picture is drawn as an image, never as markup, so it
  cannot run script or load anything; loading a file drops anything that is not such an image.
  The model's inspector lists its own icons and removes them. Layout only: the kernel never sees
  them. In the icon view a storage's level shows as a gauge.

### 6.1 Packing and unpacking (M7a, FR-GRP-001)

Odum's diagrams zoom: a storage drawn once at one scale is many storages at the next, and an
"Expenses" flow out of a bank is every bill paid. Zoom groups let one diagram be read at both.

- **Pack**: select symbols and press Ctrl/⌘-G (or **Group** in the inspector). The new group goes
  inside the deepest group that holds them all; a selected symbol inside a group below that brings
  its whole group along, so nesting is kept. Groups nest to any depth.
- **Packed**, a group draws as one stacked box at the centre of what it holds, with its name and
  how many symbols it holds. Every flow between the same two visible ends, at least one a packed
  group, draws as **one combined flow** labelled with its count. During playback the combined flow
  reads ΣJ, the sum of its flows' rates, and is drawn that wide when Flow widths is on; the group
  reads Σ, the total of the storages inside when they share one carrier, and nothing otherwise.
  A control packed in a group is drawn from the group's symbol.
- **Unpacked**, a group draws as a tinted frame around its contents, with its name and a pack
  button. Groups inside it keep their own packing.
- Double-click, or the + on a packed group, unpacks it; the − on a frame packs it. Dragging a
  group moves everything in it. Selecting a symbol or flow that is packed out of sight (from the
  checks, or a combined flow's list) unpacks what hides it.
- A combined flow, selected, lists its flows with their rates; each is a link that unpacks to it.
- A packed group carries the worst problem among its contents (FR-VAL-002), so nothing hides an
  error. A combined flow carries its flows' problems.
- **Ungroup** removes a group and keeps its contents, moved up a level. Deleting a group deletes
  what it holds. Groups follow renames and deletions, and a group left empty goes.
- **Ports** (Odum's inset, as he draws a bank inside a city): when the flows across a packed
  group's edge reach at most three symbols inside it, the group draws a small copy of each inside
  its box, and each combined flow ends on the copy of the symbol it really reaches; flows to
  different symbols inside are not combined. Two ports are labelled; three show their names on
  hover. A combined flow of one flow draws as that flow (dashed for money, with its transaction
  diamond). Past three, the group is one box, as before.
- Wiring onto a port connects to the symbol inside. Otherwise you cannot wire to a packed group:
  unpack it to connect to a symbol inside.
- A group, selected, lists every flow **across its edge**: the flow, the symbol outside, and the
  symbol inside it reaches. **See this group in the kernel model** shows the kernel JSON of the
  symbols inside and every flow touching them (§7.1), so the wiring can be checked against the
  diagram.
- The **Buying water for a home** example packs a home's water tank and bank account: water runs
  in from a utility's dam to the tank, and the water bill out of the bank account, each to its
  own port.
- Packing and moving are layout: neither marks a run "Model changed since this run" (FR-RES-005).
- The **Household budget** example packs eleven bills and renewals into Expenses, with Housing,
  Phone and internet, Living and Renewals inside it. Bills are constant flows; renewals are
  repeating table forcings (FR-FRC-001).
- Later (M7b): save a group as a reusable symbol (a kernel `archetypes` template), and unpack a
  built-in composite (producer, consumer) into the members the kernel runs.

## 7. Simulation (FR-SIM)

### 7.1 Kernel JSON

`toKernelModel` strips everything the kernel does not read. A control reference to a composite is
rewritten to the composite's state member (`{id}__body`, `{id}__box`), working around K-1 (§17).

**See what the kernel runs** (the model's inspector, with nothing selected) shows this JSON as
the kernel is given it, with the model hash every run's manifest carries, and copies it. Groups,
boundaries and layout are not in it.

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
  label and each storage's level against its reference level. A **Flow widths** toggle (off by
  default, remembered) also draws each flow as wide as |J| relative to the run's largest flow, a
  Sankey-style reading. Two more toggles, remembered, show the level: **Level gauges** (on by
  default), a bar beside the symbol, and **Level fill** (off by default), the symbol itself
  filled from the bottom up to its level. A symbol with no closed outline to fill (a heat sink)
  keeps its gauge.
- **FR-RES-004** CSV download of every sample, node and flow.
- **FR-RES-005** A result older than the model is marked "Model changed since this run": when
  the model the kernel would be given differs, not when only layout, packing or notes changed.
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

### 9.1 Code: the Energese SDK (FR-SDK, M8)

The `.gssk.json` document is the model; the diagram and TypeScript are builders of it (ADR 0011).
GSSK is a general kernel and Energese is one language over it (ADR 0012). See
[docs/architecture.md](docs/architecture.md).

- **FR-SDK-001** `src/sdk/gssk/` is a domain-neutral builder (`GsskModel`: `addNode`, `addEdge`,
  `addBoundary`, `addGroup`, `synth`), with forcing on nodes and flows (FR-FRC-001). `src/sdk/energese/`
  offers one construct per symbol (§5.2), `Flow`, `Boundary` and `Group`, and one helper per flow
  logic over it. `synth()` returns a studio model, field for field as
  `normaliseModel` writes one.
- **FR-SDK-002** `toEnergese` writes any model as declarative Energese TypeScript: one statement
  per symbol, flow and boundary; ids only where the label would not give the same one. Export
  offers it as `.energese.ts`.
- **FR-SDK-003** Round trip: running the generated code synthesizes the same file byte for byte
  (observations aside, FR-SDK-004) and the same kernel run (same model hash), for every example
  and every symbol and logic.
- **FR-SDK-004** `synth({ previous })` keeps, by id, the positions, flow curves and group packing
  a script leaves unset and the previous model's observations; an observation whose target is gone is unmapped.
- **FR-SDK-005** Nodes left unplaced are laid out left to right by flow distance from the nodes
  nothing flows into, heat sinks below, never on top of another node.
- **FR-SDK-006** A code view beside the diagram (ADR 0013): Monaco shows the model as Energese
  code; tsrs type-checks every edit against the SDK's types and lists problems at their line;
  Apply runs the script in a sandboxed worker (no network, 10 s limit) and its model replaces the
  current one as one undoable edit, keeping layout and observations (FR-SDK-004).
- **FR-SDK-007** A hand-written script travels with the model it built as `_energese`: its source
  and the model hash (FR-SIM-003) of what it built. The code view shows that script while the
  model still has that hash, and otherwise shows the generated code and says the script is out of
  date. Applying code that is exactly the model's generated form keeps no script.

## 10. Validation (FR-VAL)

- **FR-VAL-001** On every edit: errors (missing endpoints, duplicate or unusable ids, a logic
  missing its control or threshold, non-numeric values, a non-positive step, an end before the
  start, more than 500,000 steps) and warnings (isolated symbols, flows into a source, flows out of
  a heat sink, long composite ids, forcing errors and forcing under `auto`, §12.3). Each names and
  links to the node or flow at fault.
- **FR-VAL-002** On the canvas, a symbol or flow with an error has a soft, slowly pulsing red
  light behind it, and one with only warnings a steady amber one. The symbol's own outline and
  line colour never change, so they stay free to carry other meaning (an energetic type, say).
  The pulse stops under reduced motion. Each also carries a "!" badge whose tooltip lists its
  problems, so colour is never the only signal. Clicking the badge selects it. Lights and badges
  are left out of diagram exports.

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

### 12.3 Forcing functions (M5, FR-FRC-001)

- A source, a constant or a flow can carry a **forcing**: the kernel's own `forcing` block
  (`$defs/Forcing`), stored as the kernel reads it. On a source or constant it drives the held
  value; on a flow it drives the rate k in place of `params.k`. Waveforms: step, impulse, ramp,
  exponential, sine, square, sawtooth, jitter (random, from the seeded kernel RNG) and table
  (points in model time, linear or step between them, held or repeated past the ends), each with
  optional clamps. A storage cannot be forced: its level is the integral of its flows, and the
  kernel refuses it.
- The inspector edits the waveform in the kernel's terms and draws it over the run. The preview
  uses the kernel's formulas in TypeScript; a kernel test holds it equal to
  `GSSK_EvaluateNodeForcing`/`GSSK_EvaluateEdgeForcing` for every waveform (ADR 0009).
- Forced symbols and flows carry a small wave mark (∿) on the canvas, and their tooltip says how
  they are forced. Checks (FR-VAL-001) name what the kernel would refuse: a forced storage, a
  periodic wave with no positive period, a table whose times do not increase, clamps the wrong way
  round. They warn that `auto` disagrees with its own solver check on forced models (K-7).
- The **Seasonal river** example forces its rain with a sine and its evaporation rate with a
  square wave.

### 12.4 Ensembles (M5, FR-ENS-001)

- **Ensemble** (Results) runs `GSSK_EnsembleForecast` on the current run's model: 2–500 runs, each
  scaling every flow's k by its own uniform draw from [1 − p, 1 + p], with an explicit uint64
  seed (NFR-DET-001). The same seed, model and kernel give the same band.
- Each charted series gets a shaded band from the lowest to the highest value any run reached at
  each time, and a dotted line for their mean. The status names the runs, p and the seed, and the
  tooltip gives the band at the hovered time. It says plainly that every run is perturbed (the
  mean is not the run) and that only rates are varied.
- The kernel holds three doubles per step per kernel node, so an ensemble over 4 million cells is
  refused in words. It is one kernel call in the worker, without progress (ADR 0009).
- Every run manifest now records the kernel RNG seed, since jitter forcing draws from it.

## 13. External services (M6, opt-in, planned)

- **NFR-PRIV-003** No silent network. v1 makes no request outside its own origin; the build's CSP
  is `connect-src 'self'`, and an e2e test asserts no foreign request.
- A future service (a live data source, an AI write-up of a run) must be enabled by the user,
  consented per call, listed in the CSP at build time, and its key held in memory or encrypted at
  rest — never in plain `localStorage`.
- **NFR-HON-002** An LLM never produces a result: every outcome shown comes from a kernel run
  with its run id. It may propose structure and set inputs (a rate, an initial value, a
  capacity), each marked as an assumption with its provenance until a person or calibration
  replaces it, and counted in every run's manifest (ADR 0016).

## 14. Storage and security

- **NFR-PRIV-001** Models are stored in this browser's IndexedDB and in files the user exports.
- **NFR-PRIV-002** No real observation data or private models are committed; `data/` and `private/`
  are git-ignored.
- **NFR-STO-001** IndexedDB schema changes are additive, versioned migrations.
- **NFR-STO-005** Works offline after the first load (service worker precaches every built file,
  including `gssk.wasm`).

## 15. Technology and kernel

- TypeScript 7 strict, erasable syntax only, explicit `.ts` imports; Vite 8; Vitest; Playwright.
- Runtime dependencies: `monaco-editor` and `@tsrs/wasm`, for the code view only, at exact
  versions and loaded on demand (ADR 0013). Nothing else at runtime (ADR 0001).
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
- **NFR-PERF-003** The code view's JS ≤ 1,100 kB gzipped, excluding `tsrs.wasm`; loaded on
  demand from `assets/code/`, never precached (ADR 0013).
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
- **K-7** In `auto` mode, any forcing (on a source or a flow) makes nearly every step return
  `GSSK_WARN_SOLVER_DIVERGENCE` (household example with a sine on its income: 1,180 of 1,200
  steps), while `rk4`, `expm` and `euler` run clean. The matrix-exponential side appears to hold
  the forcing constant across a step. Request: evaluate forcing within the expm step, or have
  auto choose RK4 for forced models, and say which it did. Until then the checks warn and
  recommend `rk4`.
- **K-8** `GSSK_EnsembleForecast` has no progress callback or cancel, and perturbs every run,
  so no member is the unperturbed run. Request: a chunked or cancellable ensemble, and an option
  to include the base run.
- **K-9** Transactions: priced counter-flows. The `exchange` node computes nothing (its outflows
  are 0 and no storage changes), and nothing outside quality accounting reads `coupled_edge`.
  Request, specified in full with acceptance tests in
  [docs/kernel/K-9-transactions.md](docs/kernel/K-9-transactions.md):
  - carrier `kind`, plus ISO 4217 `currency` or ISO 24165 `dti`;
  - a `price` edge logic computing J_money = P × J_goods, or a money-driven inverse, with P
    constant, from a node or forced;
  - payer exhaustion that stops the purchase and conserves money;
  - validation of pairs;
  - getters for price and coupling;
  - repair or deprecation of `exchange`.
- **K-10** `coupled_edge` naming an edge that does not exist is accepted silently. Request:
  reject it, and reject self-coupling and non-reciprocal coupling (K-9 KX-14).

## 18. Repository layout

See [AGENTS.md](AGENTS.md#layout).

## 19. Milestones

| ID  | Scope                                                                                                                                              | Status                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| M0  | Foundation: spec, ADRs, pinned kernel in a worker, app shell, CI, offline, CSP                                                                     | done                       |
| M1  | Editor and runs: palette, wiring, gates, boundaries, inspector, checks, undo, results, playback                                                    | done                       |
| M2  | Run progress and cancel, multi-select, copy/paste, align, SVG/PNG diagram export, run comparison, sensor                                           | done                       |
| M3  | Observations and fitness (§11)                                                                                                                     | done                       |
| M4  | Calibration and sensitivity (§12)                                                                                                                  | done                       |
| M5  | Forcing functions and ensembles (§12)                                                                                                              | done                       |
| M6  | Opt-in services: live data sources, AI run write-up, report/PDF export (§13)                                                                       | planned                    |
| M7a | Zoom groups: pack and unpack symbols, nested, with combined flows (§6.1)                                                                           | done                       |
| M7b | Building blocks: packed groups saved as cited, tested blocks with typed ports, from a library repository (ADR 0017); unpacking built-in composites | proposed                   |
| M8  | Energese SDK: builder, constructs, code generation, round trip (§9.1); code view (ADR 0013)                                                        | done                       |
| M9  | Repeatability index and an embeddable model viewer (docs/architecture.md)                                                                          | planned                    |
| M10 | Publishing: GitHub and Zenodo through a token proxy (ADR 0014)                                                                                     | planned                    |
| M11 | Article editing: LaTeX in the browser, figures bound to runs                                                                                       | planned                    |
| M12 | Assistant: chat that edits through the app's operations as cards to apply; local model first; inputs it sets are marked (ADR 0016)                 | proposed                   |
| M13 | Energetic types (§5.5) and transactions (§5.6); priced counter-flows when the kernel has K-9                                                       | done; pricing waits on K-9 |

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
