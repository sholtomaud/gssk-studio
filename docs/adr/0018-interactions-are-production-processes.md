# ADR 0018 — An interaction is a production process: one chevron, its pathways as flows

**Status**: accepted

## Context

The owner, reading H.T. and E.C. Odum's _Modeling for All Scales_ (2000, ch. 2, Fig. 2.6), pointed
out that the app's interaction was only half of Odum's.

In Odum's energy systems language an **interaction** (work gate, the chevron) is a production
process. Two or more pathways, each carrying something different and each necessary, combine to
make a product of a third kind, with used energy to the heat sink. The interaction holds nothing;
it is the production function. **All the flows into and out of it are in proportion to that
function**, each with its own coefficient:

- the product out, k₁·A·B;
- each ingredient drawn in, its own k·A·B;
- the used energy to the heat sink, k·A·B.

The inputs are arranged by transformity: the main input (most energy, lowest transformity) from
the left, the highest-transformity input, often a control feedback, from the right. Variants
multiply three or more inputs, divide the main input by the control (dilution), or subtract
the control from it.

The app had one form: dropping a symbol onto a flow made that flow J = k·Q₀·Qc and drew a small
gate on it. The control was only read (the kernel never drains a control), there was no
used-energy pathway, and the control was drawn as a dashed line, which in this app means money.

The pinned kernel (GSSK 5.3.0) already computes everything a process needs, on ordinary edges:

- `interaction` logic, F = k·Q_origin·Q_control, with up to eight controls
  (`params.control_nodes`, its ADR 0008, after Fig. 2.6c);
- `ratio`, the divisor (Fig. 2.6d);
- `subtract`, the subtracting action (Fig. 2.6e).

Controls are read, never consumed.

## Decision

1. **A process is diagram data; its pathways are kernel edges.** `_diagram.processes` holds each
   process:
   - its operation (product, divide or subtract);
   - its main input;
   - its controls, each **used up** or **only read**;
   - its product target and its heat sink;
   - where its chevron is drawn.

   The editor keeps a set of ordinary edges in step with it, each tagged
   `visual.process = { id, role }`:
   - **product**: input → target, with the process's logic and controls;
   - **used energy**: input → heat sink, with the same logic and controls;
   - **use** of each used-up control: control → heat sink, J = k·Q_control·Q_input·(the other
     controls), so an ingredient is drawn down in proportion to production.

   Each pathway keeps its own k, carrier and forcing. The kernel sees only edges, so a model file
   is still a plain GSSK model (ADR 0003), and packing or moving a chevron changes nothing it
   runs.

2. **Several controls** use the kernel's `control_nodes`. The app gains that field everywhere a
   flow's control is handled: files, kernel JSON, checks, renames and deletions, copy and paste,
   and Energese code.

3. **Drawing.** One chevron per process, pointing left to right and marked with its operation
   (`*` once per multiplied control, `÷`, `−`):
   - the main input enters at the left;
   - the product leaves at the right;
   - the used energy drops to its heat sink;
   - each control curves in from its own side as a solid line with an arrow, drawn as a full
     pathway when used up and as a thinner line when only read.

   The process's edges are not drawn on their own.

4. **Making one.**
   - Dropping a symbol onto a flow makes the flow the product pathway of a new process, with the
     symbol as a read-only control and a used-energy pathway.
   - The palette's **Interaction** places an empty chevron to wire: the first symbol wired onto it
     becomes the main input, later ones controls; its output port wires the product.
   - The heat sink is the nearest sink below the chevron, or a new one.

   The inspector edits the operation, each control's used-up or read-only setting, every
   pathway's k, and the ends.

5. **The kernel's `interaction` node** (a processing node with its own inputs and outputs) leaves
   the palette, as `exchange` did. Models that have one still load and run.

6. A plain interaction flow (a gate on one flow, as before) still loads and draws, with the
   control as a solid curve. Its inspector offers **Make it a process**.

## Consequences

- A process's used energy and ingredient drawdown are visible and editable, so models carry the
  second law and the ingredient balance Odum writes into his equations.
- Converting a flow adds pathways, so results change. The examples keep their plain interaction
  flows until one is converted on purpose, with its kernel snapshot updated.
- Copying a selection copies a process's edges as plain flows; copying the process itself is
  later work.
- The assistant gets an `add_interaction` tool, and its reference entry describes processes.
