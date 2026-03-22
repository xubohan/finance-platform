# Market Workspace

This repository now defaults to a single `Market Workspace` product flow:

- search assets
- inspect quote / K-line / local history coverage
- sync local OHLCV history explicitly when needed
- run reproducible single-asset backtests against local-first data
- review paginated trade logs with the current page persisted in workspace state

Single-asset backtests currently support:

- `buy_hold`
- `ma_cross`
- `ema_cross`
- `macd_signal`
- `rsi_reversal`
- `stochastic_reversal`
- `mfi_reversal`
- `bollinger_reversion`
- `donchian_breakout`
- `supertrend_follow`
- `adx_trend`
- `keltner_reversion`
- `vwap_reversion`
- `atr_breakout`
- `cci_reversal`
- `obv_trend`
- `dmi_breakout`
- `chaikin_reversal`

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
4. run frontend build + performance budget gate
5. run frontend route/runtime smoke scripts

If Docker access is unavailable in the current shell, it falls back to local Python/npm checks and skips runtime smoke.

Useful direct commands:

```bash
bash scripts/smoke_frontend_routes.sh
bash scripts/smoke_runtime.sh
```

## CI

GitHub Actions now runs two blocking checks on pull requests and `main` pushes:

- frontend test + build via `npm test` and `npm run build`
- frontend performance budget via `npm run check:performance`
- full workspace validation via `bash scripts/run_workspace_validation.sh`

The workflow is defined in `.github/workflows/ci.yml`. Local verification should use the same scripts so CI and local evidence stay aligned.

## Frontend Performance Budget

The frontend now enforces a build-time budget file at `frontend/performance-budget.json`.

- `npm run build` generates the dist assets
- `npm run check:performance` checks initial JS/CSS payload and the named lazy chunks
- CI treats budget overflow as a blocking failure
- the workspace runtime panel also shows frontend runtime metrics for summary refresh, K-line refresh, backtest execution, and chart redraw slow events

## Observability

The backend now exposes `GET /api/v1/system/observability` for lightweight in-process runtime diagnostics. It aggregates:

- HTTP request totals, status buckets, and route latency summaries
- slow-route detection using the configured `OBSERVABILITY_SLOW_REQUEST_MS` threshold
- hot 4xx/5xx routes
- market workflow counters and summaries such as crypto quote cache fallback rate, stock local quote hit rate, manual sync success rate, and movers success rate

The frontend `RuntimeModePanel` reads the same endpoint so local UI diagnostics and backend smoke validation stay aligned.

## Cache Maintenance

The backend now also exposes cache maintenance endpoints for the research cache tables:

- `GET /api/v1/system/cache-maintenance` shows current retention, total rows, and purgeable/expired rows for `market_snapshot_daily` and `backtest_cache`
- `POST /api/v1/system/cache-maintenance/cleanup?dry_run=true|false` previews or executes cleanup

The workspace runtime panel shows the same cache-maintenance summary so pending cleanup is visible without opening the database directly.

## Nightly Provider Health

This repo now includes a nightly provider health check for stock and crypto data sources.

- local/manual run: `bash scripts/nightly_data_source_healthcheck.sh`
- CI schedule: `.github/workflows/nightly-provider-health.yml`
- report output: `logs/maintenance/provider_healthcheck_<timestamp>.json`

The health check currently probes:

- US stock snapshot
- US stock symbols
- `AAPL` OHLCV history
- `BTC` realtime quote
- `BTC` OHLCV history

## Release Flow

This repo now includes a standardized Docker-first release flow:

- `bash scripts/release_workflow.sh snapshot`
- `bash scripts/release_workflow.sh promote`
- `bash scripts/release_workflow.sh rollback logs/releases/release_state_<timestamp>.json`

The detailed runbook is in `docs/release-runbook.md`.

## Weekly Visual Regression

The repository now includes a stable weekly visual regression flow for the current Market Workspace layout.

- local/manual run: `bash scripts/run_workspace_visual_regression.sh`
- regenerate baseline: `WRITE_BASELINE=1 bash scripts/run_workspace_visual_regression.sh`
- workflow: `.github/workflows/weekly-visual-regression.yml`
- baseline manifest: `docs/visual-regression/market_workspace_baseline.json`
- runtime artifact directory: `logs/visual-regression/`

The visual regression run compares fixed mock-backed captures of:

- `workspace-overview`
- `workspace-chart`
- `workspace-backtest`
