# ADR 0007 — The diagram editor and the chart are in-house SVG

**Status**: accepted (M1)

## Context

ADR 0001 rules out runtime dependencies. The editor needs Odum's symbols, Bézier flows, work
gates, pan and zoom; the results need a time-series chart with a crosshair and a table view.

## Decision

- `<diagram-canvas>` draws SVG `<symbol>`s with `currentColor`, so themes recolour them. All
  geometry (anchors, curves, midpoints, bounds) is in `src/diagram/geometry.ts`, pure and tested.
  The canvas never owns the model: it emits edits built by `src/model/ops.ts`.
- `<results-panel>` draws one shared y-axis, series coloured from the validated eight-slot
  palette by entity (never cycled; a ninth is refused), a hover crosshair and tooltip, direct end
  labels for four or fewer series, and a table view. Long series are min/max decimated to the
  pixel width.

## Consequences

- The bundle stays small (≈ 42 kB gzipped JS at M1, budget 400 kB).
- Multi-select, copy/paste and alignment are ours to build (M2).
