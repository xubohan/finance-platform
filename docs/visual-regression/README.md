# Visual Regression

This repository uses stable mock-backed captures for weekly workspace regression.

## Local run

```bash
bash scripts/run_workspace_visual_regression.sh
```

To regenerate the committed baseline manifest:

```bash
WRITE_BASELINE=1 bash scripts/run_workspace_visual_regression.sh
```

## What gets captured

- `workspace-overview`
- `workspace-chart`
- `workspace-backtest`

## Why mock-backed

The live market workspace renders realtime quotes, timestamps, observability counters, and cache status.
Those values naturally drift on every run, so screenshot hashes would be noisy and useless.

The capture script intercepts the relevant `/api/v1/...` requests and returns fixed fixtures, so only actual
UI regressions change the visual baseline.
