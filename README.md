# GSSK Studio

Draw energy-systems models in Howard T. Odum's Energy Systems Language and simulate them in your
browser on the GSSK kernel. Sources, storages, producers, consumers, work gates, transactions,
switches and flows; the diagram is the model, and the pinned GSSK WebAssembly kernel integrates
it.

GSSK Studio is the professional successor to
[gssk-dia](https://github.com/energese-project/gssk-dia), built to the standard of
[budget-app](https://github.com/sholtomaud/budget-app).

- **Every Odum symbol is a native kernel type.** A producer runs as the kernel's producer
  composite, not as a storage.
- **Private.** Models live in your browser and in files you export. Nothing leaves the page.
- **Reproducible.** Every run records the kernel version and hash and a hash of the model.
- **Works offline** after the first visit.

## Using it

1. Open an example, or start a new model.
2. Click or drag symbols from the palette. Drag from a symbol's blue port to another symbol to
   draw a flow, or onto a flow to make that symbol its control (a work gate).
3. Set values and rates in the inspector. Problems are listed under Checks.
4. Press **Run** (Ctrl/⌘-Enter). Scrub or play the result to watch levels and flows on the diagram.
5. Export the model as `.gssk.json`, or the results as CSV.

## Developing

Node 22.18 or later.

```bash
npm ci
npm run dev          # Vite dev server
npm test             # unit and real-kernel tests
npm run e2e          # Playwright against the production build
```

[AGENTS.md](AGENTS.md) is the contribution standard, [SPEC.md](SPEC.md) the requirements, and
[docs/adr/](docs/adr/index.md) the decisions.

## Licence

MIT. The GSSK kernel in `vendor/gssk/` is vendored from
[energese-project/GSSK-Giannantoni](https://github.com/energese-project/GSSK-Giannantoni).
