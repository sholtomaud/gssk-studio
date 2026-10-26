# Architecture decisions

| ADR                                                    | Decision                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| [0001](0001-budget-app-foundation.md)                  | Build on budget-app's foundation: no framework, no runtime deps      |
| [0002](0002-shared-gssk-pin.md)                        | Vendor the same SHA-256-pinned GSSK build as budget-app              |
| [0003](0003-the-diagram-is-the-model.md)               | The saved file is a GSSK model; every symbol is a native kernel type |
| [0004](0004-whole-runs-in-a-worker.md)                 | Whole runs in a worker, then playback                                |
| [0005](0005-no-network-in-v1.md)                       | No network in v1; services later, opt-in and per call                |
| [0006](0006-importing-gssk-dia.md)                     | Import gssk-dia models, listing every change                         |
| [0007](0007-svg-editor-and-chart-in-house.md)          | The diagram editor and the chart are in-house SVG                    |
| [0008](0008-calibration-in-the-app.md)                 | Calibration and sensitivity in the app, over kernel runs             |
| [0011](0011-json-is-canonical-code-is-a-builder.md)    | The JSON is canonical; code and the diagram are builders             |
| [0012](0012-gssk-is-general-energese-is-a-language.md) | GSSK is general; Energese is one language on it                      |
| [0013](0013-code-view-tsrs-and-monaco.md)              | The code view: tsrs and Monaco, self-hosted, loaded on demand        |
| [0014](0014-services-through-a-token-proxy.md)         | Proposed: publishing services through a stateless token proxy        |
