# ADR 0003 — The diagram is the model

**Status**: accepted (M1)

## Context

gssk-dia draws twelve Odum symbols but folds them onto four kernel primitives
(`KERNEL_TYPE_MAP`) before running: a producer runs as a plain storage, an amplifier as a constant.
What runs is not what was drawn. Its saved documents also carry editor fields (`boundaries`,
`dataType`) that are not part of the kernel schema.

The pinned kernel (Schema v4) has native types for every symbol: `producer` and `consumer`
composites, `misc_box`, and the processing nodes `interaction`, `exchange`, `switch`, `gain` and
`loop_limited`. Its schema allows a free-form `visual` on nodes and edges and ignores any
`_`-prefixed key.

## Decision

- A studio model is a GSSK Schema v4 model. Node `type` is the kernel type; the symbol is derived
  from it through one table (`src/model/catalogue.ts`).
- Layout lives in `visual`; diagram-only data in the root `_diagram` block.
- The kernel is sent `toKernelModel(m)`: the same model without editor data, so the run's model
  hash is independent of layout.
- Composites are charted by their state member (`body`, or `box`), found through
  `GSSK_GetNodeComposite` and `GSSK_GetNodeRole`, never by parsing ids.
- Where the kernel cannot take the model as drawn, the rewrite is made in `toKernelModel`, tested,
  and filed as a kernel request. The one today is K-1 (a composite as a control).

## Consequences

- An exported `.gssk.json` loads in `GSSK_Init` unchanged, except under K-1.
- Composite parameters (`k_production`, `k_respiration`, `k_metabolism`) are editable in the
  inspector.
