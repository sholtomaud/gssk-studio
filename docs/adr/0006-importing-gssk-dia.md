# ADR 0006 — Import gssk-dia models, listing every change

**Status**: accepted (M1)

## Context

Users have models in gssk-dia's format: visual-only type names (`transaction`, `amplifier`,
`receiver`, `box`), `control_node` sometimes on the edge instead of in `params`, root
`boundaries`, `dataType` mappings, and edges without ids.

## Decision

`parseModel` accepts a studio file, a plain kernel model or a gssk-dia export and normalises it:
legacy type names map to kernel types, edge-level `control_node` moves into `params`, `boundaries`
moves into `_diagram`, unplaced nodes go on a grid, missing ids are generated, `incipient` becomes
`expm`. Every change is returned as a note and shown under Checks. Anything it cannot interpret —
an unknown type or logic — is refused with a reason, not guessed.

## Consequences

- No import silently changes what a model means.
- `dataType` is dropped with a note until observations arrive (M3).
