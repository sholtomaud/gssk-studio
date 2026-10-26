# Energese Studio — architecture

This document describes where GSSK Studio is going: a studio for writing, simulating and
publishing systems models, with the model document as its centre. It explains the ADRs from 0009
on and the milestones from M8 on (SPEC §19). Requirements stay in [SPEC.md](../SPEC.md);
decisions stay in [docs/adr/](adr/).

## 1. What is being built

- **Energese Studio** (this app, renamed when M8 ships): the author's tool. Draw a model, or write
  it in TypeScript, or both. Run it on the pinned kernel, fit it to data, write the paper around
  it, and publish the lot.
- **The model capsule**: a `.gssk.json` model, the data it was fitted to, and the manifests of the
  runs a paper cites. It is the unit of citation, of review and of archiving.
- **The model viewer**: a small custom element that loads a capsule on any page, re-runs it on the
  pinned kernel, and shows the diagram, the results and how repeatable they are (§6). This is what
  a journal embeds in an article page.

The studio is how capsules get made. The capsule format and the viewer are what a publisher
adopts, because they cost a publisher one embed and no change to how authors write.

## 2. Principles

1. **The JSON is canonical** (ADR 0009). One document is the model everywhere. The diagram, the
   code and any other tool only build it.
2. **GSSK is general; Energese is one language** (ADR 0010). Nothing below the Energese layer
   knows about Odum. Other vocabularies (bond graphs, compartments, system dynamics) target the
   same builder and kernel.
3. **Repeatability is the product** (§6). Every number can be traced to a model hash, a kernel
   hash and a method, and can be re-run by anyone.
4. **Local first; services opt-in** (ADR 0005, ADR 0012). Nothing leaves the browser until the
   author connects a service, for that action.
5. **An LLM never produces a number** (NFR-HON-002).

## 3. Layers

```
             ┌──────────── authoring ────────────┐        ┌──── reading ────┐
             │ diagram    code view    article   │        │  model viewer   │
             │ (SVG)      (tsrs+Monaco) (LaTeX)  │        │  (embeddable)   │
             └───────┬──────────┬────────────────┘        └───────┬─────────┘
                     │ edits    │ synth()                         │
                     ▼          ▼                                 ▼
  energese     constructs: Source, Storage, Producer … ; toEnergese (codegen)
  domain libs  anyone's constructs (bond graphs, epidemiology …)
                     │
  @gssk/builder  GsskModel: addNode, addEdge, addBoundary, synth, layout
                     │
  @gssk/schema   the document: types, checks, canonical JSON, hashes    ◀── .gssk.json files
                     │
  @gssk/kernel   pinned gssk.wasm in a worker: verify, run, sample, manifest
```

Today all of these are folders in this repository (ADR 0010 maps each one). They become packages
when a second consumer needs them: the viewer, tsrs-monaco, or budget-app, which pins the same
kernel (ADR 0002).

## 4. One document, several builders

| Route    | How it builds the document                       | Goes back the other way?                                        |
| -------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Diagram  | Edits it directly (`src/model/ops.ts`)           | It is the document                                              |
| Code     | A script's `synth()` result replaces it          | Yes: `toEnergese` writes any model as code that synthesizes it  |
| Files    | Import, as today (FR-IO-002)                     | Export (FR-IO-001)                                              |
| AI (M12) | Proposes Energese code, which is checked and run | The same code view; the author accepts the change like any edit |

**The round trip** (FR-SDK-003). For every model, `toEnergese(model)` is plain, declarative code,
and running it gives back the same file byte for byte, and the same kernel run. The tests run it
over every example and over a model with every symbol and logic, and the generated examples are
checked in so `tsc` and Prettier check them too (`tests/fixtures/energese/generated/`).

**Generators.** A hand-written script can use loops, functions and libraries
(`tests/fixtures/energese/food-chain.energese.ts`). It is a way of producing the document, like a
drawing session. Running it again replaces the structure it builds, and keeps the positions,
curves and observations it does not set (FR-SDK-004). The script can travel beside the model as
provenance, never instead of it. So a model always moves between authors as one file, whichever
way it was made.

```ts
import * as ener from 'energese';

const m = new ener.Model('Grassland food chain', { tEnd: 200, dt: 0.1, method: 'rk4' });
const sun = new ener.Source(m, 'Sunlight', { id: 'sun', value: 100 });
const grass = new ener.Producer(m, 'Grass', { value: 20 });
const grazers = new ener.Consumer(m, 'Grazers', { value: 5 });
const heat = new ener.HeatSink(m, 'Heat');
new ener.Flow(m, sun, grass, ener.linear(0.02), { id: 'photosynthesis' });
new ener.Flow(m, grass, grazers, ener.interaction(0.01, grazers), { id: 'grazing' });
new ener.Flow(m, grass, heat, ener.linear(0.01));
new ener.Flow(m, grazers, heat, ener.linear(0.02));

export default m;
```

**A domain library** is a function or class over `GsskModel` (ADR 0010):

```ts
import type { GsskModel } from '@gssk/builder';

export function logisticPopulation(m: GsskModel, name: string, o: { r: number; K: number }) {
  const supply = m.addNode('source', `${name} supply`, { value: 1 });
  const pop = m.addNode('storage', name, { value: 1 });
  m.addEdge(supply, pop, 'limit', { k: o.r, threshold: o.K });
  return pop;
}
```

## 5. The code view (ADR 0011, proposed)

```
 Monaco (one model per file: model.energese.ts, lib/*.ts)
   │ debounced
   ▼
 compiler worker: tsrs tsc over an in-memory project
   │  + node_modules/energese/*.d.ts, @gssk/builder/*.d.ts
   │  ──► diagnostics as Monaco markers
   ▼ emitted JS
 script worker (no DOM, no network)
   │  bare 'energese' → the bundled SDK; relative imports → Blob URLs
   │  import(entry); default export must be a GsskModel
   ▼  synth({ previous }) → JSON
 studio-page: one undoable edit, then checks, then Run as usual
```

- The code view shows either the **generated** form of the current model, or a **script** the
  author is writing, and says which.
- Scripts run once to produce a document. **They never run inside the integration loop.** A
  per-step callback into JavaScript would cross from wasm into JS at every step, and would make
  the results depend on the browser's JavaScript engine (§6). Rate laws the kernel lacks are kernel
  requests, not callbacks.

### Speed, honestly

The kernel is not faster than V8 today. SPEC §17 K-4 measures about 64 µs per step for 18 nodes
on the pinned 5.3.0, where a plain JavaScript RK4 loop over 18 states would take well under a
microsecond. The kernel's per-step passes (quality accounting, reclassification) cost the time,
not wasm. When K-4 is fixed, compiled C in wasm should run at or somewhat faster than JIT-compiled
JavaScript, and ensembles and calibration gain the most, because thousands of runs never leave
wasm.

The case for the kernel is repeatability, not speed. ECMAScript leaves `Math.exp`, `Math.log`,
`Math.pow` and the like "implementation-approximated", so the same JavaScript can give different
last bits in Chrome, Firefox and Safari. A wasm binary carries its own maths library, so the same
`gssk.wasm` gives bit-identical results in every browser, in Node, and in CI. The SHA-256 pin
says which binary that was.

## 6. The repeatability index (M9, proposed)

The index is a level, worked out from evidence the software can check. An author cannot simply
declare it. It is a ladder, not a weighted score: a weighted score invites gaming and hides what
is missing, while a level says exactly what to do next. The terms follow the ACM's artifact
badging: _repeatable_ (same team, same setup), _reproducible_ (another team, same setup),
_replicable_ (another team, another setup).

| Level | Name           | Evidence (each level includes those below)                                                                                                       |
| ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| R0    | Unrecorded     | Numbers with no manifest                                                                                                                         |
| R1    | Identified     | A run manifest: model hash, kernel version and SHA-256, method, dt, steps (FR-SIM-003; every studio run today)                                   |
| R2    | Self-contained | A capsule: the model, every input series (hashed) and the manifests, so that re-running needs nothing else                                       |
| R3    | Repeated       | Re-run from the capsule on the pinned kernel and matched the recorded results bit for bit (or within a stated tolerance on another kernel build) |
| R4    | Archived       | The capsule has a persistent identifier (a Zenodo DOI) and an open licence, and the kernel build it names is itself archived                     |
| R5    | Reproduced     | Re-run and matched by another party (a reviewer, a reader's viewer, another group's CI), and that re-run is recorded against the DOI             |

Shown beside the level, not folded into it, are **numerical confidence** measures: the kernel's
dual-solver agreement (FR-SIM-004), a step-halving check (re-run at dt/2 and report the largest
change), and the sensitivity of each cited result to its fitted rates (FR-SEN-001). They say
whether the numbers are sound, which is a different question from whether they can be repeated.

The viewer computes R3 on every page load: it re-runs the capsule and compares. That is the
demonstration for a publisher. The figure on the page re-runs itself and shows it matches.

## 7. Article editing (M11)

Journals want their own classes (`elsarticle` for Elsevier), so the article is LaTeX. The studio
adds `\gsskfigure{capsule}{run}`, a figure bound to a run manifest. When the PDF is built it
renders from the recorded results, and the online article embeds the viewer instead.

The engine sits behind an `ArticleEngine` interface (compile a file tree to a PDF and a log, in a
worker), loaded on demand like the code view:

- **First: an existing TeX engine compiled to wasm** (SwiftLaTeX, BusyTeX), self-hosted with a
  curated package bundle (the journal classes plus the common packages) so compiling needs no
  network. Check each project's licence before shipping: some are GPL or AGPL, which matters for
  a product you sell.
- **Not first: a TeX engine written in Rust (tex-rs).** TeX itself (`tex.web`) is portable, but
  LaTeX documents depend on the e-TeX, pdfTeX and XeTeX extensions and on their font and PDF
  back ends, which make up most of the work. Tectonic (a Rust driver around the XeTeX engine)
  shows what is involved. A Rust engine can replace the first one behind the same interface later,
  if size, speed or licensing call for it.
- **Optionally, Typst for drafts.** It is far smaller and compiles instantly. Submission still
  goes through LaTeX.

## 8. The assistant (M12)

budget-app's `src/api/` layer carries over: providers (Gemini among them, through the user's own
key or OpenRouter), streaming, and redaction. The assistant's tools are the app's own methods:
read the model, propose Energese code, run, fit, explain a result, draft a paragraph. Its code goes
through the same checks as anyone's: tsrs type-checks it, `validate` checks it, the kernel runs it,
and the author accepts it as one undoable edit. It may describe a run; it never writes a number
into a model or a paper (NFR-HON-002).

## 9. Publishing (M10, ADR 0012)

- **GitHub**: one repository per paper holding `paper/*.tex`, `models/*.gssk.json`,
  `models/*.energese.ts` (provenance), `runs/*.json` (manifests) and `data/` (inputs). OAuth goes
  through a stateless token-exchange function on AWS Lambda. The token stays in memory.
- **Zenodo**: a DOI from a GitHub release (Zenodo's own GitHub integration), or a direct deposit
  of the capsule. The DOI raises the index to R4.
- **arXiv**: there is no general open submission API, so the studio exports a submission bundle
  (`.tex`, figures, `.bbl`).
- **Publishers**: later, a journal's submission system takes the capsule DOI, and its article page
  embeds the viewer.

## 10. Reuse across the repositories

- **boba**: the template the app shell and components follow (ADR 0001).
- **tsrs-monaco**: its editor, compiler worker and run worker become the code view's component
  (ADR 0011). The playground stays as a demo of that component.
- **budget-app**: shares the kernel pin (ADR 0002). Its LLM layer becomes the assistant's (§8).
  Later it can use `@gssk/builder` for its own models.

## 11. Open questions

1. Should the capsule be its own file format (a zip of a fixed layout) or a directory convention
   in a repository? A directory is easier to review in git; a zip is easier to deposit and embed.
2. R3 tolerance: when the kernel build changes, what counts as a match? Proposal: an exact match
   on the same SHA-256; on another build, a relative tolerance stated in the capsule.
3. Do domain libraries need to say which kernel types they emit, so the viewer can refuse a
   capsule its kernel cannot run before trying?
4. Renaming the app and the repository to Energese Studio: when M8's code view ships, or now?
