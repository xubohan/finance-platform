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

    def _mock_snapshot(market: str, limit: int) -> list[dict]:
        assert market == "us"
        return sample[:limit]

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

    monkeypatch.setattr(backtest_api, "fetch_stock_snapshot", _mock_snapshot)
    monkeypatch.setattr(backtest_api, "fetch_ohlcv", lambda **kwargs: candles)
    monkeypatch.setattr(backtest_api, "fetch_stock_universe_total", lambda market: 6789)
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
    assert len(resp["data"]) == 50
    assert resp["data"][0]["symbol"] == "US00070"


def test_backtest_lab_returns_502_when_live_source_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(backtest_api, "fetch_stock_snapshot", lambda market, limit: [])

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
