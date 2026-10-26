# ADR 0009 — The JSON is canonical; code and the diagram are builders

**Status**: accepted (M8)

## Context

Authors will build models three ways: by drawing (the studio's diagram), by writing TypeScript
against an SDK (Energese, ADR 0010), and by editing or generating GSSK JSON with other tools. If
any of these became a second source of truth, a model would have to be kept in step in two forms,
and a model written as a program could only be moved, cited or archived together with the code
and the toolchain that runs it.

ADR 0003 already makes the saved file a GSSK Schema v4 model. The question is what TypeScript is
for.

## Decision

- **The `.gssk.json` document is the model**, everywhere: in the library, in files, in a
  repository, in a deposit, in a paper. Nothing else is saved as the model.
- **The diagram and TypeScript are builders of that document.** The diagram edits it directly.
  An Energese script is run and its result, `model.synth()`, is the document. The script is not
  saved in place of the model, and the studio never needs the script to open, run or cite a model.
- **Every model has one generated TypeScript form** (`toEnergese`, FR-SDK-002): plain,
  declarative, one statement per node, flow and boundary. Running it gives back the same document
  (FR-SDK-003, the round trip). That is how a drawn model becomes code, and how the code view
  shows any model.
- **Hand-written scripts may use the full language** (loops, functions, imported libraries). They
  are generators: running one replaces the model's nodes, flows and boundaries with what it
  builds. Positions and flow curves the script leaves unset, and the model's observations, are
  kept by id (FR-SDK-004), so drawing and scripting can alternate without losing layout or data.
- A script's text may travel _with_ a model as provenance (its hash in the run manifest, the file
  beside the model in a repository), never instead of it.

## Consequences

- One source of truth. A model built by any route is shared, diffed, hashed and deposited the
  same way, and any GSSK runtime can load it without TypeScript.
- Editing the diagram after running a hand-written generator does not rewrite that script; the
  generated form shows the result. Re-running the script replaces the edited structure. The code
  view says which one the user is looking at.
- The SDK must be able to say everything the document can say, or the round trip breaks. The
  round-trip test runs over every example and every symbol.
