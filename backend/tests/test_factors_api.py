"""Tests for factors API behavior on live market snapshot universe."""

from __future__ import annotations

import asyncio

from fastapi import HTTPException
import pandas as pd
import pytest

from app.api import factors as factors_api


def _snapshot_rows(count: int) -> list[dict]:
    rows: list[dict] = []
    for idx in range(1, count + 1):
        rows.append(
            {
                "symbol": f"US{idx:05d}",
                "name": f"Stock {idx}",
                "market": "US",
                "pe_ttm": 5 + (idx % 30),
                "roe": 8 + (idx % 20),
                "profit_yoy": 2 + (idx % 40),
                "change_pct": float((idx % 15) - 7),
            }
        )
    return rows


def test_factors_score_full_universe_then_paginate(monkeypatch: pytest.MonkeyPatch) -> None:
    sample = _snapshot_rows(120)

    def _mock_snapshot(
        market: str,
        limit: int,
        *,
        force_refresh: bool = False,
        allow_stale: bool = True,
    ) -> tuple[list[dict], dict]:
        assert market == "us"
        return sample[:limit], {"source": "live", "stale": False, "as_of": "2026-03-02T00:00:00+00:00", "cache_age_sec": 0}

    monkeypatch.setattr(factors_api, "fetch_stock_snapshot_with_meta", _mock_snapshot)
    monkeypatch.setattr(
        factors_api,
        "fetch_stock_universe_total_with_meta",
        lambda market, force_refresh=False, allow_stale=True: (
            5432,
            {"source": "live", "stale": False, "as_of": "2026-03-02T00:00:00+00:00", "cache_age_sec": 0},
        ),
    )

    payload = factors_api.FactorScoreRequest(
        weights=factors_api.FactorWeights(value=25, growth=25, momentum=25, quality=25),
        market="us",
        symbol_limit=20000,
        page=2,
        page_size=50,
    )
    resp = asyncio.run(factors_api.factors_score(payload))

    assert resp["meta"]["count"] == 50
    assert resp["meta"]["total_items"] == 120
    assert resp["meta"]["total_pages"] == 3
    assert resp["meta"]["page"] == 2
    assert resp["meta"]["page_size"] == 50
    assert resp["meta"]["market"] == "us"
    assert resp["meta"]["symbols_fetched"] == 120
    assert resp["meta"]["total_available"] == 5432
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["stale"] is False
    assert resp["meta"]["as_of"] == "2026-03-02T00:00:00+00:00"
    assert len(resp["data"]) == 50


def test_factors_score_rejects_invalid_weights() -> None:
    payload = factors_api.FactorScoreRequest(
        weights=factors_api.FactorWeights(value=20, growth=20, momentum=20, quality=20),
        market="us",
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(factors_api.factors_score(payload))

    assert exc.value.status_code == 400
    assert exc.value.detail["error"]["code"] == "INVALID_WEIGHTS"


def test_factors_score_deduplicates_symbols_across_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    base_rows = _snapshot_rows(120)
    duplicated_rows = base_rows + base_rows[:20]

    def _mock_snapshot(
        market: str,
        limit: int,
        *,
        force_refresh: bool = False,
        allow_stale: bool = True,
    ) -> tuple[list[dict], dict]:
        assert market == "us"
        return duplicated_rows[:limit], {"source": "live", "stale": False, "as_of": "2026-03-02T00:00:00+00:00", "cache_age_sec": 0}

    monkeypatch.setattr(factors_api, "fetch_stock_snapshot_with_meta", _mock_snapshot)
    monkeypatch.setattr(
        factors_api,
        "fetch_stock_universe_total_with_meta",
        lambda market, force_refresh=False, allow_stale=True: (
            5432,
            {"source": "live", "stale": False, "as_of": "2026-03-02T00:00:00+00:00", "cache_age_sec": 0},
        ),
    )

    page1 = factors_api.FactorScoreRequest(
        weights=factors_api.FactorWeights(value=25, growth=25, momentum=25, quality=25),
        market="us",
        symbol_limit=20000,
        page=1,
        page_size=50,
    )
    page2 = factors_api.FactorScoreRequest(
        weights=factors_api.FactorWeights(value=25, growth=25, momentum=25, quality=25),
        market="us",
        symbol_limit=20000,
        page=2,
        page_size=50,
    )
    resp_page1 = asyncio.run(factors_api.factors_score(page1))
    resp_page2 = asyncio.run(factors_api.factors_score(page2))

    symbols_page1 = {row["symbol"] for row in resp_page1["data"]}
    symbols_page2 = {row["symbol"] for row in resp_page2["data"]}

    assert resp_page1["meta"]["total_items"] == 120
    assert resp_page2["meta"]["total_items"] == 120
    assert symbols_page1.isdisjoint(symbols_page2)


def test_factors_score_returns_502_when_live_source_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        factors_api,
        "fetch_stock_snapshot_with_meta",
        lambda market, limit, force_refresh=False, allow_stale=True: ([], {"source": "live", "stale": False, "as_of": None, "cache_age_sec": None}),
    )

    payload = factors_api.FactorScoreRequest(
        weights=factors_api.FactorWeights(value=25, growth=25, momentum=25, quality=25),
        market="cn",
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(factors_api.factors_score(payload))

    assert exc.value.status_code == 502
    assert exc.value.detail["error"]["code"] == "UPSTREAM_UNAVAILABLE"


@pytest.mark.parametrize(
    "start_date,end_date",
    [
        ("2023-03-03", "2026-03-03"),  # 3Y window
        ("2021-03-03", "2026-03-03"),  # 5Y window
    ],
)
def test_factors_backtest_supports_3y_5y_windows(
    monkeypatch: pytest.MonkeyPatch,
    start_date: str,
    end_date: str,
) -> None:
    sample = _snapshot_rows(80)

    def _mock_snapshot(
        market: str,
        limit: int,
        *,
        force_refresh: bool = False,
        allow_stale: bool = True,
    ) -> tuple[list[dict], dict]:
        assert market == "us"
        return sample[:limit], {"source": "live", "stale": False, "as_of": "2026-03-03T00:00:00+00:00", "cache_age_sec": 0}

    def _mock_ohlcv_with_meta(
        symbol: str,
        start_date: str,
        end_date: str,
        interval: str = "1d",
    ) -> tuple[pd.DataFrame, dict]:
        dates = pd.date_range(start=start_date, end=end_date, freq="B", tz="UTC")
        base = 100.0 + (abs(hash(symbol)) % 20)
        closes = [base + i * 0.05 for i in range(len(dates))]
        frame = pd.DataFrame(
            {
                "time": dates,
                "open": closes,
                "high": [v + 0.5 for v in closes],
                "low": [v - 0.5 for v in closes],
                "close": closes,
                "volume": [1000.0] * len(dates),
            }
        )
        return frame, {"source": "live", "stale": False, "as_of": "2026-03-03T00:00:00+00:00"}

    async def _mock_load_ohlcv_window(
        db,
        symbol: str,
        asset_type: str,
        start_date: str,
        end_date: str,
        interval: str = "1d",
        prefer_local: bool = True,
    ):
        frame, meta = _mock_ohlcv_with_meta(symbol=symbol, start_date=start_date, end_date=end_date, interval=interval)
        return frame, {**meta, "source": "live", "sync_performed": True}

    monkeypatch.setattr(factors_api, "fetch_stock_snapshot_with_meta", _mock_snapshot)
    monkeypatch.setattr(factors_api, "load_ohlcv_window", _mock_load_ohlcv_window)

    payload = factors_api.FactorBacktestRequest(
        weights=factors_api.FactorWeights(value=25, growth=25, momentum=25, quality=25),
        market="us",
        start_date=start_date,
        end_date=end_date,
        rebalance="M",
        top_n=20,
        symbol_limit=80,
    )
    resp = asyncio.run(factors_api.factors_backtest(payload, db=None))

    assert isinstance(resp["data"]["equity_curve"], list)
    assert len(resp["data"]["equity_curve"]) > 100
    assert isinstance(resp["data"]["benchmark_curve"], list)
    assert isinstance(resp["data"]["rebalance_history"], list)
    assert "summary" in resp["data"]
    assert "metrics" in resp["data"]
    assert "benchmark_metrics" in resp["data"]
    assert "total_return" in resp["data"]["metrics"]
    assert "final_value" in resp["data"]["metrics"]
    assert resp["meta"]["market"] == "us"
    assert resp["meta"]["symbols_fetched"] == 80
    assert resp["meta"]["symbols_used"] > 0
    assert resp["meta"]["cache_hit"] is False


def test_factors_backtest_returns_404_when_snapshot_rows_missing_required_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sample = [{"symbol": "US00001", "name": "Incomplete Row", "market": "US"}]

    monkeypatch.setattr(
        factors_api,
        "fetch_stock_snapshot_with_meta",
        lambda market, limit, force_refresh=False, allow_stale=True: (
            sample[:limit],
            {"source": "live", "stale": False, "as_of": "2026-03-03T00:00:00+00:00", "cache_age_sec": 0},
        ),
    )

    payload = factors_api.FactorBacktestRequest(
        weights=factors_api.FactorWeights(value=25, growth=25, momentum=25, quality=25),
        market="us",
        start_date="2023-03-03",
        end_date="2026-03-03",
        rebalance="M",
        top_n=20,
        symbol_limit=80,
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(factors_api.factors_backtest(payload, db=None))

    assert exc.value.status_code == 404
    assert exc.value.detail["error"]["code"] == "DATA_NOT_FOUND"
