# ADR 0016 — The assistant edits through the app's own operations, and marks every number it sets

**Status**: accepted (M12). Amends NFR-HON-002 at the owner's request. Calibration and
Energese scripts as tools, and drawing a card's draft on the canvas, are still to come.

## Context

The owner wants an LLM chat in the studio that can build and change models: move symbols, add
and remove them, wire flows. The aim is to teach people, and the models themselves, what a valid
energy-systems model is and how to make one. Two earlier projects show the pattern:

- **llamafile-idea-clustering.** A local llamafile serves an OpenAI-style API on localhost. The
  page calls it through a same-machine proxy. Deterministic code does the work (embeddings, then
  k-means); the model only names the clusters.
- **budget-app** (ADRs 0021, 0023), the same family as this app (ADR 0001):
  - one egress gate, with consent showing the exact payload;
  - keys held in memory only, never saved;
  - local OpenAI-compatible servers (llama-server, Ollama, LM Studio) as first-class providers;
  - a fixed tool set with strict schemas;
  - every change proposed as a card to Apply or Undo;
  - no figure in a reply that is not from a tool result.

Until now NFR-HON-002 said an LLM never produces or alters a number. The owner has decided that
the assistant may also set parameter values, such as a rate k, an initial level or a capacity,
when they are clearly marked. A model sketched in conversation needs some numbers before it can
run at all, and nothing else exists to supply them.

## Decision

### Tools are the app's own operations

The assistant gets a fixed tool set with strict schemas. Each tool is a thin wrapper over a
function that already exists:

- **Reading:**
  - `describe_model` (symbols, flows, carriers, groups, at the current packing);
  - `get_checks` (`validate.ts`);
  - `get_kernel_json` (`toKernelModel`);
  - `get_run_summary` (the last run's manifest, finals and diagnostics, by run id).
- **Editing** (`src/model/ops.ts`, `groups.ts`, `transactions.ts`, `carriers.ts`):
  - `add_symbol`, `remove`, `connect`, `set_control`, `move`, `set_params`, `set_carrier`;
  - `group`, `pack`;
  - `add_transaction`, `add_counter_flow`.
- **Running:** `run_model` and `calibrate`, over the same worker as the Run button (ADR 0004).
- **Code:** `propose_energese` returns an Energese script (ADR 0011). The app runs it in the
  script sandbox (ADR 0013) and proposes what it builds.

Every editing tool returns a proposed model, never one already applied. The chat shows each
proposal as a card with the change listed and drawn on the canvas, to **Apply** or **Discard**.
An applied card is one undo step (FR-EDIT-007). A tool call that the checks reject is answered
with the checks' own messages, so the model learns validity from the app, not from its own
guesses.

### Numbers: results never, assumptions marked

NFR-HON-002 now reads: **an LLM never produces a result.** Every number shown as an outcome
(levels, flows, fits, sensitivities, prices) comes from a kernel run, with its run id. The
assistant may set **inputs**: a rate k, an initial value, a capacity or a forcing. Each one it
sets is marked:

- **Recorded** in the model file as `_provenance` beside the value:
  `{ by: "assistant", provider, model, at, why }`. The kernel never sees it (`_`-prefixed).
- **Shown** on the canvas: a small "assumed" mark on the symbol or flow, beside the value in the
  inspector, and as an info item in the checks ("3 values were set by the assistant and are not
  from data").
- **Counted** in every run's manifest (`assumedInputs: 3`), so a result says how much of it rests
  on guesses (NFR-HON-001).
- **Replaced, not hidden.** Editing the value by hand marks it `by: "user"`. Calibration against
  observations marks it `by: "calibration"` with the observation set and fit. Nothing clears the
  mark silently.

A reply that states a figure must cite the tool result it came from. A figure in a reply that is
in no tool result of that turn is struck out and flagged, as budget-app does.

### Providers and the network (ADR 0005, NFR-PRIV-003)

The assistant is off until the person turns it on.

- **Local first:** a llamafile or llama-server on `http://localhost` or `http://127.0.0.1`, as in
  the idea-clustering app. It needs no key, and nothing leaves the machine.
- **Hosted, optional:** the Anthropic Messages API, OpenAI-compatible endpoints, and Gemini
  through its OpenAI-compatible endpoint. Each origin is listed in the build's CSP
  `connect-src`; the list is static.
- **Consent per call** with the exact payload, as in budget-app. The keys are held in memory for
  the session only.
- **Sent:** the model's structure and the person's message. Observations are sent only when the
  person attaches them.
- **Log:** each call goes to a local log (time, provider, purpose, body hash, status).

### Teaching

The assistant explains with the app's own material:

- the symbol catalogue's summaries;
- the checks' messages;
- the kernel JSON (`get_kernel_json`, the same view as "See what the kernel runs").

Asked to build "a house that buys water", it proposes the structure as cards one step at a time:

1. the storages and the flow;
2. the transaction and its money counter-flow;
3. the group;
4. assumed rates, each marked;
5. a run.

Each card says why. The person can apply them one at a time.

## Consequences

- AGENTS.md's non-negotiable 4 and NFR-HON-002 are reworded: no LLM-produced _result_;
  LLM-set _inputs_ are allowed only with provenance.
- `_provenance` is a new editor-only block. Files without it load as before.
- The tool layer is DOM-free and unit-tested against the real operations. A scripted fake provider
  drives e2e tests, so CI needs no network or model.
- The e2e test that no request leaves the origin keeps passing with the assistant off. A second
  test asserts that each call goes only to the chosen provider's origin, after consent.
- Widening `connect-src` reaches the Energese script worker too, which inherits the page's
  policy (ADR 0013). The worker therefore seals every network API (`fetch`, XHR, WebSocket,
  EventSource, `sendBeacon`) and `Worker` before a script loads, and an e2e test asserts a
  script cannot reach localhost.
- This builds on M10's services groundwork (ADR 0014) for the hosted providers. The local
  provider needs none of it.
