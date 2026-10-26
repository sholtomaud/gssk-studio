# ADR 0009 — Forcing in the kernel's schema; ensembles in one kernel call

**Status**: accepted (M5)

## Context

SPEC §12.3 planned forcing functions previewed with `GSSK_EvaluateNodeForcing`, so the drawn
curve is the simulated one, and ensembles from `GSSK_EnsembleForecast` with an explicit seed.

The kernel's evaluators need a live instance, which lives in the sim worker. A preview that asks
the worker on every keystroke would build an instance per edit and lag behind typing, and it
cannot draw a model the kernel refuses (a sine with its period half typed).

`GSSK_EnsembleForecast` does every run and the reduction in a single call. It has no progress
callback and no cancel. Probing the pinned 5.3.0 build: every run is perturbed (no member is the
base run), each scales every edge's k by a uniform draw from [1 − p, 1 + p], and the result is
deterministic for a seed set with `GSSK_SetSeed`.

## Decision

- Forcing is stored as the kernel's own `forcing` block on nodes and edges (ADR 0003): no studio
  format, no translation. `toKernelModel` passes it through unchanged.
- The inspector's preview evaluates the kernel's published formulas in TypeScript
  (`src/model/forcing.ts`). `tests/kernel/forcing.test.ts` holds that evaluation equal to
  `GSSK_EvaluateEdgeForcing`/`GSSK_EvaluateNodeForcing` to nine decimal places for every
  waveform, clamps and table modes, so the preview cannot drift from the kernel unnoticed.
- Ensembles call `GSSK_EnsembleForecast` once in the worker, read the envelope through the flat
  getters (never the struct layout), sample it like a run, and free it. Seed, runs, p, model hash
  and kernel version label the band. Size is bounded up front (4 million envelope cells) so the
  kernel's allocation cannot exhaust the worker. No progress and no cancel; filed as K-8.

## Consequences

- The preview is instant and draws while a model is invalid; the kernel stays the authority.
- A kernel update that changes a formula fails the kernel test instead of shipping a wrong
  preview.
- A large ensemble blocks the worker until it finishes: runs started meanwhile wait. With K-4's
  per-step cost, 500 runs of a 500,000-step model would take minutes, which the cell limit and
  the run cap keep within reason.
- The band's mean is not the run; the UI says so. Including the base run waits on K-8.
