# ADR 0010 — GSSK is general; Energese is one language on it

**Status**: accepted (M8)

## Context

GSSK is a general systems simulation kernel: stocks, flows and the processing nodes that connect
them, in any domain. Energese is Odum's Energy Systems Language: one vocabulary for drawing and
writing such systems. Bond graphs, compartment models, system dynamics and other domain
vocabularies can compile to the same kernel. If the SDK or the kernel runner were named and shaped
as Energese, every other domain would depend on an energy-systems package to reach a general
kernel.

Domain libraries are normally maintained by their own communities, in their own repositories and
npm scopes. A scheme that expected them under `@energese/` would not match that practice.

## Decision

Layers, each depending only on those above it in this table:

| Layer        | Planned package | What it is                                                                                                                            | Today, in this repository     |
| ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| GSSK schema  | `@gssk/schema`  | The model document's types, checks, canonical JSON and hashing                                                                        | `src/model/`                  |
| GSSK builder | `@gssk/builder` | A domain-neutral builder: kernel node types and flow logics, ids, layout, `synth()`                                                   | `src/sdk/gssk/`               |
| GSSK kernel  | `@gssk/kernel`  | The pinned wasm and its runner: verify the hash, run, sample, manifest                                                                | `src/sim/`, `src/workers/`    |
| Energese     | `energese`      | Odum's symbols as constructs (`Source`, `Storage`, `Producer` …) and flow logics, over `@gssk/builder`; generates code from any model | `src/sdk/energese/`           |
| Domain libs  | anyone's        | Constructs over `@gssk/builder` (or over `energese`), published by their maintainers                                                  | `tests/unit/energese.test.ts` |

- **The construct contract** is the builder's public API: a domain library takes a
  `GsskModel` and adds nodes and flows to it through `addNode` and `addEdge`, returning handles.
  It does not need Energese, and Energese has no special access.
- Packages are carved out of this repository only when a second consumer needs them
  (tsrs-monaco, budget-app, a viewer widget). Until then the folders above are the boundaries, and
  nothing under `src/sdk/` imports from `src/app/`.

## Consequences

- A bond-graph or epidemiology library can target GSSK without an energy-systems dependency, and
  a journal or society can maintain its own.
- Energese stays the studio's drawing and writing language: the diagram's symbols and the
  generated code use its names.
- When the kernel gains types (SPEC §17), they arrive in `@gssk/builder` first; Energese adds a
  symbol only when Odum's language has one.
