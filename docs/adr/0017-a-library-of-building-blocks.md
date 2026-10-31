# ADR 0017 — A library of building blocks: reusable, cited, checked, in its own repository

**Status**: proposed (M7b, with M9 and M10)

## Context

The owner wants to bootstrap large models of real systems from parts: dynamic general-systems,
ecological and macro-econometric modelling. For example:

- the Australian economy as a complex system;
- inside it, the ASX and the companies listed there, government departments, the Reserve Bank,
  households, and the rest of the world;
- each part a symbol that others can reuse, verify and validate.

LLM agents would build the library out over time.

The studio already has most of the pieces:

- **Groups** (ADR 0010) pack many symbols into one.
- **Ports** (FR-GRP-001) show which symbol inside each crossing flow reaches. They are a block's
  interface.
- **Carriers** (ADR 0015) are typed by UCUM, ISO 4217 and COICOP.
- **Calibration and fitness** (ADR 0008) test a model against observations.
- **The Energese SDK** (ADR 0012) builds a model in code.

What is missing:

- a block format;
- a place for blocks to live;
- a source for every number;
- a way for a block to earn trust.

## Decision

### A block is a packed group saved to a file

A **block** (`.gssk-block.json`) holds:

- its symbols, flows and carriers, plus any icons;
- its **ports**: the symbols inside that flows from outside may connect to, each with a carrier.
  Connecting is checked against the port's carrier.
- its **parameters**, each with a **source**:
  - **cited data**: dataset, table, series id, URL, date and licence;
  - **calibration**: the observations and the fit;
  - **assumption**: who made it and why, as ADR 0016 marks assistant-set values.
- **classification codes**, from the standards ADR 0015 already uses:
  - SNA 2008 institutional sector, for who the block is (for example S.14 households,
    S.13 general government, S.11 non-financial corporations);
  - ANZSIC 2006 or ISIC Rev. 4 industry, and GICS for a listed company;
  - CPC for the products it trades;
  - COICOP for household purposes.
- **tests**: observation series it must reproduce within a stated fitness, and the kernel version
  it was checked on.

Placing a block in a model adds it as a packed group with fresh ids (copy semantics, as
FR-EDIT-011). It is not a kernel `archetype`: archetypes cap a template at 16 nodes and 32 edges
and two ports, and expand inside the kernel where the studio cannot show them (ADR 0010).
A placed block remembers where it came from (`_block: { id, version, hash }`). The library can
then offer updates, and a model can say which blocks it is built from.

### The library lives in its own repository

The library is a separate public repository (working name `gssk-library`), not this one. This
repository holds no real data (NFR-PRIV-002), and blocks are data with their own review pace and
licences.

- **Layout:** one folder per block, for example `au/economy/households/` or
  `au/asx/companies/<ticker>/`. Each holds the block file, a README, its data extracts as CSV
  with licences, and its tests.
- **CI:** every block runs on the pinned kernel (the same GSSK pin, ADR 0002). CI checks:
  - that its checks pass;
  - that its tests reproduce their observations within the stated fitness;
  - that every parameter has a source.
- **Trust levels**, shown in the studio:
  1. **structural**: checks pass;
  2. **runs**: it runs reproducibly;
  3. **fitted**: it reproduces its observations;
  4. **reviewed**: a person has signed it off in a merged review.
- **Getting blocks:** the studio imports a block file offline from the start. Browsing the
  library's published index comes with the opt-in services (M10, ADR 0014), as one more origin
  in the CSP.

### Agents build, people approve, data gives the numbers

LLM agents (Claude Code sessions, run on a schedule) propose blocks as pull requests to the
library:

- They write **structure**: symbols, flows, ports and codes, in Energese code that builds the
  block (ADR 0011).
- They write **extraction scripts**. Deterministic scripts pull the numbers from public sources
  into CSV, for example:
  - ABS national accounts and input-output tables;
  - RBA statistical tables;
  - ASX company reports;
  - ABS energy accounts.
- **Numbers come from those extracts or from calibration**, never typed by the agent. A
  parameter without a source fails the library's CI. The only exception is an assumption marked
  as ADR 0016 marks one.
- **People review and merge.** Merging is what makes a block "reviewed".

### Bootstrap order

1. **Sectors of the Australian economy as SNA sectors:** households, non-financial
   corporations, financial corporations, general government, and the rest of the world.
2. **Flows between sectors**, from the ABS national and sector accounts:
   - wages, consumption, taxes, transfers and investment;
   - imports and exports.
3. Unpack financial corporations into the RBA, banks and the ASX.
4. Unpack the ASX into listed companies (GICS sectors, then tickers).
5. Unpack the economy's energy and material base from the ABS energy and water accounts, so money
   and energy run side by side as Odum draws them.

Each step is blocks that plug into the ports of the step before. A coarse model can run at any
step.

## Consequences

- M7b's scope becomes: block files, ports with carriers, placing and updating blocks, and
  showing a block's sources and trust level.
- A new repository and its CI. The studio keeps no real data.
- Source tracking (`_provenance`, shared with ADR 0016) becomes part of the model file. Run
  manifests can then say how much of a result rests on cited data, calibration or assumption.
- Blocks give the repeatability index (M9) something to index.
