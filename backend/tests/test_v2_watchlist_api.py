"""Contract tests for /api/v2/watchlist routes."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.api.v2 import watchlist as watchlist_v2

from tests._v2_testutils import FakeResult, QueueAsyncSession, make_client


def test_v2_watchlist_list_returns_rows_and_count() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "symbol": "AAPL",
                        "asset_type": "stock",
                        "name": "Apple",
                        "sort_order": 0,
                        "added_at": datetime(2026, 3, 25, tzinfo=timezone.utc),
                    }
                ]
            )
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/watchlist")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["count"] == 1
    assert payload["data"][0]["symbol"] == "AAPL"


def test_v2_watchlist_add_normalizes_symbol_and_commits() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(rows=[{"name": "Apple Inc"}]),
            FakeResult(
                rows=[
                    {
                        "symbol": "AAPL",
                        "asset_type": "stock",
                        "name": "Apple Inc",
                        "sort_order": 2,
                        "added_at": datetime(2026, 3, 25, tzinfo=timezone.utc),
                    }
                ]
            )
        ]
    )
    client = make_client(db_session=session)

    resp = client.post("/api/v2/watchlist", json={"symbol": "aapl", "asset_type": "stock"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"]["symbol"] == "AAPL"
    assert payload["meta"]["created"] is True
    assert session.calls[0]["params"]["symbol"] == "AAPL"
    assert session.calls[1]["params"]["symbol"] == "AAPL"
    assert session.calls[1]["params"]["name"] == "Apple Inc"
    assert session.commits == 1


def test_v2_watchlist_delete_not_found_returns_404() -> None:
    session = QueueAsyncSession([FakeResult(rows=[])])
    client = make_client(db_session=session)

    resp = client.delete("/api/v2/watchlist/aapl")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"]["code"] == "NOT_FOUND"
    assert session.commits == 1


def test_v2_watchlist_delete_with_asset_type_filter() -> None:
    session = QueueAsyncSession([FakeResult(rows=[{"symbol": "AAPL", "asset_type": "stock"}])])
    client = make_client(db_session=session)

    resp = client.delete("/api/v2/watchlist/aapl", params={"asset_type": "stock"})
    assert resp.status_code == 200
    assert resp.json()["meta"]["count"] == 1
    assert session.calls[0]["params"]["symbol"] == "AAPL"
    assert session.calls[0]["params"]["asset_type"] == "stock"
    assert session.commits == 1


def test_v2_watchlist_quotes_merges_watchlist_with_market_quotes(monkeypatch: pytest.MonkeyPatch) -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {"symbol": "AAPL", "asset_type": "stock", "name": "Apple"},
                    {"symbol": "BTC", "asset_type": "crypto", "name": "Bitcoin"},
                ]
            )
        ]
    )

    async def _mock_get_quotes(payload, db):
        assert payload.symbols == ["AAPL", "BTC"]
        return {
            "data": [
                {
                    "symbol": "AAPL",
                    "price": 199.5,
                    "change_pct_24h": 1.2,
                    "source": "live",
                    "provider": "yfinance",
                    "stale": False,
                    "as_of": "2026-03-26T00:00:00+00:00",
                },
                {
                    "symbol": "BTC",
                    "price": 68000.0,
                    "change_pct_24h": -0.7,
                    "source": "live",
                    "provider": "binance",
                    "stale": False,
                    "as_of": "2026-03-26T00:00:10+00:00",
                },
            ],
            "meta": {"source": "live"},
        }

    monkeypatch.setattr(watchlist_v2, "get_quotes", _mock_get_quotes)
    client = make_client(db_session=session)

    resp = client.get("/api/v2/watchlist/quotes")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["count"] == 2
    assert payload["meta"]["source"] == "live"
    assert payload["meta"]["sources"] == ["live"]
    assert payload["meta"]["providers"] == ["binance", "yfinance"]
    assert payload["meta"]["stale_count"] == 0
    assert payload["meta"]["fresh_count"] == 2
    assert payload["meta"]["failed_count"] == 0
    assert payload["meta"]["as_of"] == "2026-03-26T00:00:10+00:00"
    assert payload["data"][0]["symbol"] == "AAPL"
    assert payload["data"][0]["price"] == 199.5
    assert payload["data"][0]["provider"] == "yfinance"
    assert payload["data"][1]["symbol"] == "BTC"
    assert payload["data"][1]["price"] == 68000.0
    assert payload["data"][1]["provider"] == "binance"


def test_v2_watchlist_quotes_empty_short_circuit(monkeypatch: pytest.MonkeyPatch) -> None:
    session = QueueAsyncSession([FakeResult(rows=[])])

    async def _fail_get_quotes(payload, db):  # pragma: no cover - assertion guard
        raise AssertionError("get_quotes should not be called for empty watchlist")

    monkeypatch.setattr(watchlist_v2, "get_quotes", _fail_get_quotes)
    client = make_client(db_session=session)

    resp = client.get("/api/v2/watchlist/quotes")
    assert resp.status_code == 200
    assert resp.json() == {"data": [], "meta": {"count": 0}}
