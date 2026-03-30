# Live Workspace Capture

This repository captures live workspace evidence instead of deterministic visual baselines.

## Local run

```bash
bash scripts/run_workspace_visual_regression.sh
```

## What gets captured

- `/`
- `/market/AAPL`
- `/backtest`

## Live-only contract

- No API interception.
- No fixed fixtures.
- No mock/demo data path.

The script captures full-page screenshots from the real runtime and writes a manifest file alongside them.
Treat the output as runtime evidence for delivery review, not as a deterministic pixel hash baseline.
