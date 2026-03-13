"""Tests for backtest API batch lab behavior."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
import pandas as pd
import pytest

from app.api import backtest as backtest_api


def _snapshot_rows(count: int) -> list[dict]:
    rows: list[dict] = []
    for idx in range(1, count + 1):
        rows.append(
            {
                "symbol": f"US{idx:05d}",
                "name": f"Stock {idx}",
                "market": "US",
            }
        )
    return rows


def _ohlcv_rows() -> pd.DataFrame:
    base = datetime(2024, 1, 1, tzinfo=timezone.utc)
    times = [base + timedelta(days=i) for i in range(40)]
    close = [100 + i * 0.5 for i in range(40)]
    return pd.DataFrame(
        {
            "time": times,
            "open": close,
            "high": [v + 1 for v in close],
            "low": [v - 1 for v in close],
            "close": close,
            "volume": [10000] * 40,
        }
    )


def test_backtest_lab_full_universe_then_paginate(monkeypatch: pytest.MonkeyPatch) -> None:
    sample = _snapshot_rows(120)
    candles = _ohlcv_rows()

    def _mock_snapshot(
        market: str,
        limit: int,
        *,
        force_refresh: bool = True,
        allow_stale: bool = False,
    ) -> tuple[list[dict], dict]:
        assert market == "us"
        return sample[:limit], {"source": "live", "stale": False, "as_of": "2026-03-02T00:00:00+00:00", "cache_age_sec": 0}

    def _mock_run(self, df, symbol, asset_type):  # type: ignore[no-untyped-def]
        score = float(int(symbol[2:]))
        return {
            "metrics": {
                "total_return": score,
                "annual_return": score / 10,
                "sharpe_ratio": 1.2,
                "max_drawdown": 8.5,
                "win_rate": 55.0,
                "trade_count": 12,
            }
        }

    async def _mock_load_ohlcv_window(**kwargs):
        return (
            candles,
            {
                "source": "local",
                "sync_performed": False,
                "stale": False,
                "as_of": "2026-03-02T00:00:00+00:00",
            },
        )

    monkeypatch.setattr(backtest_api, "fetch_stock_snapshot_with_meta", _mock_snapshot)
    monkeypatch.setattr(backtest_api, "load_ohlcv_window", _mock_load_ohlcv_window)
    monkeypatch.setattr(
        backtest_api,
        "fetch_stock_universe_total_with_meta",
        lambda market, force_refresh=True, allow_stale=False: (
            6789,
            {"source": "live", "stale": False, "as_of": "2026-03-02T00:00:00+00:00", "cache_age_sec": 0},
        ),
    )
    monkeypatch.setattr(backtest_api.BacktestEngine, "run", _mock_run)

    payload = backtest_api.BacktestLabRequest(
        market="us",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
        symbol_limit=20000,
        page=2,
        page_size=50,
    )
    resp = asyncio.run(backtest_api.run_backtest_lab(payload))

    assert resp["meta"]["count"] == 50
    assert resp["meta"]["total_items"] == 120
    assert resp["meta"]["total_pages"] == 3
    assert resp["meta"]["page"] == 2
    assert resp["meta"]["page_size"] == 50
    assert resp["meta"]["market"] == "us"
    assert resp["meta"]["symbols_fetched"] == 120
    assert resp["meta"]["symbols_backtested"] == 120
    assert resp["meta"]["total_available"] == 6789
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["stale"] is False
    assert resp["meta"]["as_of"] == "2026-03-02T00:00:00+00:00"
    assert resp["meta"]["ohlcv_live_symbols"] == 0
    assert resp["meta"]["ohlcv_local_symbols"] == 120
    assert resp["meta"]["ohlcv_failed_symbols"] == 0
    assert resp["meta"]["ohlcv_local_fallback_symbols"] == 120
    assert len(resp["data"]) == 50
    assert resp["data"][0]["symbol"] == "US00070"


def test_backtest_lab_returns_502_when_live_source_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        backtest_api,
        "fetch_stock_snapshot_with_meta",
        lambda market, limit, force_refresh=True, allow_stale=False: ([], {"source": "live", "stale": False, "as_of": None, "cache_age_sec": None}),
    )

    payload = backtest_api.BacktestLabRequest(
        market="cn",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(backtest_api.run_backtest_lab(payload))

    assert exc.value.status_code == 502
    assert exc.value.detail["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_run_backtest_prefers_local_window(monkeypatch: pytest.MonkeyPatch) -> None:
    candles = _ohlcv_rows()

    async def _mock_load_ohlcv_window(**kwargs):
        return (
            candles,
            {
                "source": "local",
                "sync_performed": False,
                "stale": False,
                "as_of": "2026-03-02T00:00:00+00:00",
                "provider": "local",
                "fetch_source": "database",
                "coverage_complete": True,
            },
        )

    monkeypatch.setattr(backtest_api, "load_ohlcv_window", _mock_load_ohlcv_window)
    monkeypatch.setattr(
        backtest_api.BacktestEngine,
        "run",
        lambda self, df, symbol, asset_type: {"metrics": {"total_return": 10.0}, "equity_curve": [], "trades": []},
    )

    payload = backtest_api.BacktestRequest(
        symbol="aapl",
        asset_type="stock",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
    )
    resp = asyncio.run(backtest_api.run_backtest(payload))

    assert resp["meta"]["ohlcv_source"] == "local"
    assert resp["meta"]["sync_performed"] is False
    assert resp["meta"]["storage_source"] == "local"
    assert resp["meta"]["coverage_complete"] is True


def test_run_backtest_rejects_partial_local_window_when_auto_sync_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _mock_load_ohlcv_window(**kwargs):
        return (
            _ohlcv_rows().iloc[:5],
            {
                "source": "local",
                "sync_performed": False,
                "stale": False,
                "as_of": "2026-03-02T00:00:00+00:00",
                "provider": "local",
                "fetch_source": "database_partial",
                "coverage_complete": False,
            },
        )

    monkeypatch.setattr(backtest_api, "load_ohlcv_window", _mock_load_ohlcv_window)

    payload = backtest_api.BacktestRequest(
        symbol="aapl",
        asset_type="stock",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
        sync_if_missing=False,
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(backtest_api.run_backtest(payload))

    assert exc.value.status_code == 409
    assert exc.value.detail["error"]["code"] == "LOCAL_DATA_INCOMPLETE"


def test_run_backtest_rejects_invalid_date_format() -> None:
    payload = backtest_api.BacktestRequest(
        symbol="AAPL",
        asset_type="stock",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="invalid-date",
        end_date="2024-12-31",
        initial_capital=1_000_000,
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(backtest_api.run_backtest(payload))

    assert exc.value.status_code == 400
    assert exc.value.detail["error"]["code"] == "INVALID_DATE_FORMAT"
