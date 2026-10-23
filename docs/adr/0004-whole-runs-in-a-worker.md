# ADR 0004 — Whole runs in a worker, then playback

**Status**: accepted (M1)

## Context

gssk-dia steps the kernel on the UI thread in animation frames, interleaving integration,
rendering and chart updates. Speed then depends on frame rate, a long run blocks the page, and the
result is never a complete artefact that can be inspected or exported.

## Decision

The sim worker runs `t_start → t_end` in one call and returns a `RunResult`: at most 2,000 samples
per node (stride sampling, final state exact), every flow, a manifest and diagnostics. The UI then
plays the result back: a scrubber and play button drive the diagram's readings, gauges and flow
widths.

## Consequences

- The UI never blocks, and every run is a complete, exportable artefact.
- Long runs give no progress yet; with K-4 that matters for large models. M2 adds progress and
  cancel (chunked runs over the same RPC).
- Live forcing from a data stream (gssk-dia's polling) becomes a forcing table (FR-FRC-001), not a
  mutation of state mid-run.
