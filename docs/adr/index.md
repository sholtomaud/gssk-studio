# Architecture decisions

| ADR                                              | Decision                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| [0001](0001-budget-app-foundation.md)            | Build on budget-app's foundation: no framework, no runtime deps      |
| [0002](0002-shared-gssk-pin.md)                  | Vendor the same SHA-256-pinned GSSK build as budget-app              |
| [0003](0003-the-diagram-is-the-model.md)         | The saved file is a GSSK model; every symbol is a native kernel type |
| [0004](0004-whole-runs-in-a-worker.md)           | Whole runs in a worker, then playback                                |
| [0005](0005-no-network-in-v1.md)                 | No network in v1; services later, opt-in and per call                |
| [0006](0006-importing-gssk-dia.md)               | Import gssk-dia models, listing every change                         |
| [0007](0007-svg-editor-and-chart-in-house.md)    | The diagram editor and the chart are in-house SVG                    |
| [0008](0008-calibration-in-the-app.md)           | Calibration and sensitivity in the app, over kernel runs             |
| [0009](0009-forcing-and-ensembles.md)            | Forcing in the kernel's schema; ensembles in one kernel call         |
| [0010](0010-zoom-groups-are-a-view.md)           | Zoom groups are a view; the kernel runs every symbol                 |
| [0011](0011-energetic-types-follow-standards.md) | Energetic types use international standards, not house names         |
