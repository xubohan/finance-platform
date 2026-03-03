"""Tests for factors API behavior on live market snapshot universe."""

from __future__ import annotations

import asyncio

from fastapi import HTTPException
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
