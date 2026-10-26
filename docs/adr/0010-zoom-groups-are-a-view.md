# ADR 0010 — Zoom groups are a view; the kernel runs every symbol

**Status**: accepted (M7a)

## Context

A diagram must be readable at more than one scale: a household's "Expenses" is one flow out of
the bank at one scale and every bill paid at the next. Odum's systems language zooms this way, and
node editors (Grasshopper's clusters) pack many components into one.

The kernel offers packing of its own: user `archetypes` (templates of at most 16 nodes and 32
edges, wired through `in` and `out` ports), expanded at `GSSK_Init`. Using them for zoom would
change what the kernel runs whenever the user packs or unpacks, cap a group's size, and limit the
flows across its edge to two ports.

## Decision

Zoom groups are editor-only (`_diagram.groups`), like boundaries. A group lists the node ids
directly in it and its parent group; packed or not is a flag. `src/model/groups.ts` derives the
view: which nodes are drawn, which groups are boxes or frames, and which flows combine. The kernel
always gets the full model from `toKernelModel`, which never reads `_diagram`.

Kernel archetypes stay for what they are for, reusable definitions, in M7b.

## Consequences

- Packing can never change a result: the model hash, the run and every number are the same.
  A unit test holds the kernel JSON equal packed, unpacked and with no groups.
- Groups have no size limit and any number of flows across their edge.
- A combined flow's ΣJ and a group's Σ are sums of the kernel's own numbers, computed for display;
  no total is shown where adding would mean nothing (storages of different carriers).
- A run is stale only when the kernel JSON changed (FR-RES-005), so packing, moving and renaming
  a label leave a run current.
