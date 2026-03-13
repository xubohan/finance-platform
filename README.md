# Market Workspace

This repository now defaults to a single `Market Workspace` product flow:

- search assets
- inspect quote / K-line / local history coverage
- sync local OHLCV history explicitly when needed
- run reproducible single-asset backtests against local-first data

Research-only routes (`factors`, `screener`) and AI routes are disabled by default and can be re-enabled with:

```bash
ENABLE_RESEARCH_APIS=true ENABLE_AI_API=true docker compose --profile experimental up -d
```

## Core Stack

Default startup:

```bash
docker compose up -d db redis backend frontend nginx
```

Health endpoints:

- `GET /health`
- `GET /api/v1/health`

## Validation

Recommended one-command validation:

```bash
bash scripts/run_workspace_validation.sh
```

The script will:

1. start the core stack with Docker Compose when Docker is available
2. wait for `api/v1/health` and `/market`
3. run backend regression tests
4. run frontend route/runtime smoke scripts

If Docker access is unavailable in the current shell, it falls back to local Python/npm checks and skips runtime smoke.

Useful direct commands:

```bash
bash scripts/smoke_frontend_routes.sh
bash scripts/smoke_runtime.sh
```
