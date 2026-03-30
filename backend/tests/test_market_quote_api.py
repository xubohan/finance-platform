"""Tests for market quote/kline API contracts."""

from __future__ import annotations

import asyncio

import pandas as pd
from fastapi import HTTPException
import pytest

from app.api import market as market_api


def test_market_quote_crypto_returns_unified_shape(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("crypto", "coinbase"))
    monkeypatch.setattr(
        market_api,
        "fetch_crypto_realtime_price",
        lambda symbols: {
            "BTC": {
                "price": 68000.5,
                "change_pct_24h": 2.31,
                "provider": "binance",
                "fetch_source": "binance",
                "as_of": "2026-03-25T12:00:00+00:00",
            }
        },
    )

    resp = asyncio.run(market_api.get_quote("BTC", db=None))

    assert resp["data"]["symbol"] == "BTC"
    assert resp["data"]["asset_type"] == "crypto"
    assert resp["data"]["price"] == 68000.5
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["stale"] is False
    assert resp["meta"]["provider"] == "binance"
    assert resp["meta"]["fetch_source"] == "binance"


def test_market_quote_stock_returns_unified_shape(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(market_api, "fetch_stock_realtime_quote", lambda symbol: {})
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-03-02", "2026-03-03"], utc=True),
            "open": [100.0, 102.0],
            "high": [103.0, 105.0],
            "low": [99.0, 101.0],
            "close": [102.0, 104.0],
            "volume": [1000.0, 1200.0],
        }
    )
    async def _mock_quote_frame(**kwargs):
        return (
            frame,
            {
                "source": "live",
                "stale": False,
                "as_of": "2026-03-03T00:00:00+00:00",
                "provider": "yfinance",
                "fetch_source": "yfinance",
                "sync_performed": True,
                "coverage_complete": True,
            },
        )

    monkeypatch.setattr(market_api, "_load_stock_quote_frame", _mock_quote_frame)

    resp = asyncio.run(market_api.get_quote("AAPL", db=None))

    assert resp["data"]["symbol"] == "AAPL"
    assert resp["data"]["asset_type"] == "stock"
    assert resp["data"]["price"] == 104.0
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["provider"] == "yfinance"
    assert resp["meta"]["fetch_source"] == "yfinance"
    assert resp["meta"]["sync_performed"] is True


def test_market_quote_stock_syncs_live_ohlcv_before_fallback(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(market_api, "fetch_stock_realtime_quote", lambda symbol: {})
    today = market_api.date.today()
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime([today - market_api.timedelta(days=2), today - market_api.timedelta(days=1)], utc=True),
            "open": [100.0, 102.0],
            "high": [103.0, 105.0],
            "low": [99.0, 101.0],
            "close": [102.0, 104.0],
            "volume": [1000.0, 1200.0],
        }
    )
    sync_calls: list[dict[str, object]] = []

    async def _mock_sync(*args, **kwargs):
        sync_calls.append({"args": args, "kwargs": kwargs})
        return frame, {"source": "live", "stale": False, "as_of": None, "provider": "yfinance", "fetch_source": "yfinance"}

    monkeypatch.setattr(market_api, "sync_ohlcv_from_upstream", _mock_sync)

    resp = asyncio.run(market_api.get_quote("AAPL", db=None))

    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["fetch_source"] == "yfinance"
    assert resp["meta"]["sync_performed"] is True
    assert len(sync_calls) == 1


def test_market_quote_stock_uses_live_provider_before_local_fallback(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(
        market_api,
        "fetch_stock_realtime_quote",
        lambda symbol: {
            "symbol": symbol,
            "price": 199.75,
            "change_pct_24h": 1.48,
            "as_of": "2026-03-25T13:50:00+00:00",
            "provider": "twelvedata",
            "fetch_source": "twelvedata",
            "source": "live",
            "stale": False,
        },
    )

    async def _fail_load_stock_quote_frame(**kwargs):
        raise AssertionError("_load_stock_quote_frame should not run when live stock quote is available")

    monkeypatch.setattr(market_api, "_load_stock_quote_frame", _fail_load_stock_quote_frame)

    resp = asyncio.run(market_api.get_quote("AAPL", db=None))

    assert resp["data"]["symbol"] == "AAPL"
    assert resp["data"]["asset_type"] == "stock"
    assert resp["data"]["price"] == 199.75
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["provider"] == "twelvedata"
    assert resp["meta"]["fetch_source"] == "twelvedata"


def test_market_quote_stock_ignores_non_live_provider_until_live_ohlcv_fallback(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(
        market_api,
        "fetch_stock_realtime_quote",
        lambda symbol: {
            "symbol": symbol,
            "price": 198.25,
            "change_pct_24h": -0.25,
            "as_of": "2026-03-25T00:00:00+00:00",
            "provider": "alphavantage",
            "fetch_source": "alphavantage_eod",
            "source": "eod",
            "stale": True,
        },
    )
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-03-24", "2026-03-25"], utc=True),
            "open": [196.0, 198.0],
            "high": [199.0, 201.0],
            "low": [195.0, 197.5],
            "close": [198.0, 200.0],
            "volume": [1000.0, 1200.0],
        }
    )

    async def _mock_quote_frame(**kwargs):
        return (
            frame,
            {
                "source": "live",
                "stale": False,
                "as_of": "2026-03-25T00:00:00+00:00",
                "provider": "yfinance",
                "fetch_source": "yfinance",
                "sync_performed": True,
                "coverage_complete": True,
            },
        )

    monkeypatch.setattr(market_api, "_load_stock_quote_frame", _mock_quote_frame)

    resp = asyncio.run(market_api.get_quote("AAPL", db=None))

    assert resp["data"]["price"] == 200.0
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["fetch_source"] == "yfinance"


def test_market_quote_stock_uses_intraday_fallback_before_daily_history(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(
        market_api,
        "fetch_stock_realtime_quote",
        lambda symbol: {
            "symbol": symbol,
            "price": 198.25,
            "change_pct_24h": -0.25,
            "as_of": "2026-03-25T00:00:00+00:00",
            "provider": "yfinance",
            "fetch_source": "yfinance",
            "source": "delayed",
            "stale": True,
        },
    )
    intraday_frame = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-03-25T15:59:00+00:00", "2026-03-25T16:00:00+00:00"], utc=True),
            "open": [199.0, 200.0],
            "high": [200.0, 201.0],
            "low": [198.5, 199.5],
            "close": [200.0, 201.5],
            "volume": [1000.0, 1200.0],
        }
    )

    def _mock_intraday(symbol: str, start_date: str, end_date: str, interval: str):
        assert symbol == "AAPL"
        assert interval == "1m"
        return intraday_frame, {
            "source": "delayed",
            "stale": True,
            "as_of": "2026-03-25T16:00:00+00:00",
            "provider": "yfinance",
            "fetch_source": "yfinance",
        }

    async def _fail_daily_history(**kwargs):
        raise AssertionError("_load_stock_quote_frame should not run when intraday fallback is available")

    monkeypatch.setattr(market_api, "fetch_ohlcv_with_meta", _mock_intraday)
    monkeypatch.setattr(market_api, "_load_stock_quote_frame", _fail_daily_history)

    resp = asyncio.run(market_api.get_quote("AAPL", db=None))

    assert resp["data"]["price"] == 201.5
    assert resp["data"]["as_of"] == "2026-03-25T16:00:00+00:00"
    assert resp["meta"]["source"] == "delayed"
    assert resp["meta"]["fetch_source"] == "yfinance"
    assert resp["meta"]["sync_performed"] is False


def test_market_quote_stock_rejects_non_live_provider_when_live_fallback_is_empty(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(
        market_api,
        "fetch_stock_realtime_quote",
        lambda symbol: {
            "symbol": symbol,
            "price": 198.25,
            "change_pct_24h": -0.25,
            "as_of": "2026-03-25T00:00:00+00:00",
            "provider": "alphavantage",
            "fetch_source": "alphavantage_eod",
            "source": "eod",
            "stale": True,
        },
    )

    async def _mock_quote_frame(**kwargs):
        return pd.DataFrame(), {"source": None, "stale": None, "as_of": None, "provider": None, "fetch_source": None}

    monkeypatch.setattr(market_api, "_load_stock_quote_frame", _mock_quote_frame)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(market_api.get_quote("AAPL", db=None))

    assert exc.value.status_code == 502
    assert exc.value.detail["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_market_kline_returns_meta_fields(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-02-28", "2026-03-03"], utc=True),
            "open": [98.0, 101.0],
            "high": [102.0, 103.0],
            "low": [97.0, 100.0],
            "close": [101.0, 102.0],
            "volume": [900.0, 1100.0],
        }
    )
    async def _mock_load_window(db, symbol, asset_type, start_date, end_date, interval="1d", prefer_local=True, sync_if_missing=True):
        return (
            frame,
            {
                "source": "live",
                "stale": False,
                "as_of": "2026-03-03T00:00:00+00:00",
                "provider": "yfinance",
                "fetch_source": "yfinance",
                "sync_performed": True,
                "coverage_complete": True,
            },
        )

    monkeypatch.setattr(market_api, "load_ohlcv_window", _mock_load_window)

    resp = asyncio.run(market_api.get_kline("AAPL", period="1d", start="2026-02-01", end="2026-03-03", db=None))

    assert len(resp["data"]) == 2
    assert resp["meta"]["asset_type"] == "stock"
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["provider"] == "yfinance"
    assert resp["meta"]["fetch_source"] == "yfinance"
    assert resp["meta"]["history_synced"] is True


def test_market_kline_resamples_daily_data_for_weekly_period(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"], utc=True),
            "open": [100.0, 101.0, 102.0, 103.0, 104.0],
            "high": [101.0, 103.0, 104.0, 105.0, 106.0],
            "low": [99.0, 100.0, 101.0, 102.0, 103.0],
            "close": [100.5, 102.5, 103.5, 104.5, 105.5],
            "volume": [1000.0, 1100.0, 1200.0, 1300.0, 1400.0],
        }
    )

    async def _mock_load_window(**kwargs):
        return (
            frame,
            {
                "source": "live",
                "stale": False,
                "as_of": "2026-03-06T00:00:00+00:00",
                "provider": "yfinance",
                "fetch_source": "yfinance",
                "sync_performed": True,
                "coverage_complete": True,
            },
        )

    monkeypatch.setattr(market_api, "load_ohlcv_window", _mock_load_window)

    resp = asyncio.run(market_api.get_kline("AAPL", period="1W", start="2026-03-01", end="2026-03-06", db=None))

    assert len(resp["data"]) == 1
    assert resp["data"][0]["time"].startswith("2026-03-06")
    assert resp["data"][0]["open"] == 100.0
    assert resp["data"][0]["high"] == 106.0
    assert resp["data"][0]["low"] == 99.0
    assert resp["data"][0]["close"] == 105.5
    assert resp["data"][0]["volume"] == 6000.0


def test_market_history_status_returns_local_summary(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))

    async def _mock_summary(db, symbol, asset_type):
        return {
            "count": 252,
            "start": "2025-01-01T00:00:00+00:00",
            "end": "2025-12-31T00:00:00+00:00",
        }

    monkeypatch.setattr(market_api, "get_local_ohlcv_summary", _mock_summary)

    resp = asyncio.run(market_api.history_status("AAPL", db=None))

    assert resp["data"]["symbol"] == "AAPL"
    assert resp["data"]["asset_type"] == "stock"
    assert resp["data"]["local_rows"] == 252
    assert resp["data"]["has_data"] is True


def test_market_summary_returns_quote_and_history_payload(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))

    async def _mock_summary(db, symbol, asset_type):
        return {
            "count": 252,
            "start": "2025-01-01T00:00:00+00:00",
            "end": "2025-12-31T00:00:00+00:00",
        }

    async def _mock_quote(symbol: str, db=None):
        return {
            "data": {
                "symbol": "AAPL",
                "asset_type": "stock",
                "price": 104.0,
                "change_pct_24h": 1.96,
                "as_of": "2026-03-03T00:00:00+00:00",
            },
            "meta": {"source": "live", "fetch_source": "yfinance", "stale": False},
        }

    monkeypatch.setattr(market_api, "get_local_ohlcv_summary", _mock_summary)
    monkeypatch.setattr(market_api, "get_quote", _mock_quote)

    resp = asyncio.run(market_api.get_summary("AAPL", db=None))

    assert resp["data"]["symbol"] == "AAPL"
    assert resp["data"]["quote"]["price"] == 104.0
    assert resp["data"]["history_status"]["local_rows"] == 252
    assert resp["meta"]["quote"]["source"] == "live"
    assert resp["meta"]["quote_error"] is None


def test_market_summary_keeps_history_when_quote_fails(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))

    async def _mock_summary(db, symbol, asset_type):
        return {
            "count": 252,
            "start": "2025-01-01T00:00:00+00:00",
            "end": "2025-12-31T00:00:00+00:00",
        }

    async def _mock_quote(symbol: str, db=None):
        raise HTTPException(
            status_code=502,
            detail=market_api._error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest quote data", {"symbol": symbol}),
        )

    monkeypatch.setattr(market_api, "get_local_ohlcv_summary", _mock_summary)
    monkeypatch.setattr(market_api, "get_quote", _mock_quote)

    resp = asyncio.run(market_api.get_summary("AAPL", db=None))

    assert resp["data"]["symbol"] == "AAPL"
    assert resp["data"]["quote"] is None
    assert resp["data"]["history_status"]["local_rows"] == 252
    assert resp["meta"]["quote"] is None
    assert resp["meta"]["quote_error"] == "Failed to fetch latest quote data"


def test_market_sync_history_persists_and_returns_summary(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("stock", "yfinance"))
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-03-02", "2026-03-03"], utc=True),
            "open": [98.0, 101.0],
            "high": [102.0, 103.0],
            "low": [97.0, 100.0],
            "close": [101.0, 102.0],
            "volume": [900.0, 1100.0],
        }
    )

    async def _mock_sync(db, symbol, asset_type, start_date, end_date, interval="1d"):
        return (
            frame,
            {"source": "live", "stale": False, "as_of": "2026-03-03T00:00:00+00:00", "provider": "yfinance", "fetch_source": "yfinance"},
        )

    async def _mock_summary(db, symbol, asset_type):
        return {
            "count": 2,
            "start": "2026-03-02T00:00:00+00:00",
            "end": "2026-03-03T00:00:00+00:00",
        }

    monkeypatch.setattr(market_api, "sync_ohlcv_from_upstream", _mock_sync)
    monkeypatch.setattr(market_api, "get_local_ohlcv_summary", _mock_summary)

    payload = market_api.HistorySyncRequest(start_date="2026-03-02", end_date="2026-03-03", period="1d")
    resp = asyncio.run(market_api.sync_history("AAPL", payload, db=None))

    assert resp["data"]["symbol"] == "AAPL"
    assert resp["data"]["rows_synced"] == 2
    assert resp["data"]["local_rows"] == 2
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["provider"] == "yfinance"


def test_market_sync_history_rejects_invalid_date_range() -> None:
    payload = market_api.HistorySyncRequest(start_date="2026-03-03", end_date="2026-03-02", period="1d")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(market_api.sync_history("AAPL", payload, db=None))

    assert exc.value.status_code == 400
    assert exc.value.detail["error"]["code"] == "INVALID_DATE_RANGE"


def test_market_quote_crypto_ignores_cache_and_uses_live_ohlcv_fallback(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("crypto", "coinbase"))
    monkeypatch.setattr(market_api, "fetch_crypto_realtime_price", lambda symbols: {})
    monkeypatch.setattr(market_api.time, "sleep", lambda _: None)
    monkeypatch.setattr(
        market_api,
        "cache_get_json",
        lambda key: {
            "symbol": "BTC",
            "asset_type": "crypto",
            "price": 70123.45,
            "change_pct_24h": 1.23,
            "as_of": "2026-03-06T08:00:00+00:00",
        },
    )
    monkeypatch.setattr(market_api, "cache_set_json", lambda key, payload, ttl_seconds: None)
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-03-06T08:00:00Z", "2026-03-06T09:00:00Z"], utc=True),
            "open": [70000.0, 70200.0],
            "high": [70300.0, 70500.0],
            "low": [69950.0, 70100.0],
            "close": [70220.0, 70450.0],
            "volume": [1200.0, 1300.0],
        }
    )
    monkeypatch.setattr(
        market_api,
        "fetch_ohlcv_with_meta",
        lambda **kwargs: (
            frame,
            {"source": "live", "stale": False, "as_of": "2026-03-06T09:00:00+00:00", "provider": "binance", "fetch_source": "binance"},
        ),
    )

    resp = asyncio.run(market_api.get_quote("BTC", db=None))

    assert resp["data"]["symbol"] == "BTC"
    assert resp["data"]["price"] == 70450.0
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["stale"] is False
    assert resp["meta"]["fetch_source"] == "binance"


def test_market_quote_crypto_returns_502_without_live_source_even_if_cache_exists(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("crypto", "coinbase"))
    monkeypatch.setattr(market_api, "fetch_crypto_realtime_price", lambda symbols: {})
    monkeypatch.setattr(market_api.time, "sleep", lambda _: None)
    monkeypatch.setattr(
        market_api,
        "cache_get_json",
        lambda key: {
            "symbol": "BTC",
            "asset_type": "crypto",
            "price": 69999.0,
            "change_pct_24h": -0.5,
            "as_of": "2026-03-06T07:55:00+00:00",
        },
    )
    monkeypatch.setattr(market_api, "fetch_ohlcv_with_meta", lambda **kwargs: (pd.DataFrame(), {}))

    with pytest.raises(HTTPException) as exc:
        asyncio.run(market_api.get_quote("BTC", db=None))

    assert exc.value.status_code == 502
    assert exc.value.detail["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_market_quote_crypto_uses_ohlcv_fallback_when_cache_empty(monkeypatch) -> None:
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("crypto", "coinbase"))
    monkeypatch.setattr(market_api, "fetch_crypto_realtime_price", lambda symbols: {})
    monkeypatch.setattr(market_api.time, "sleep", lambda _: None)
    monkeypatch.setattr(market_api, "cache_get_json", lambda key: None)
    monkeypatch.setattr(market_api, "cache_set_json", lambda key, payload, ttl_seconds: None)
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-03-02", "2026-03-03"], utc=True),
            "open": [68000.0, 69000.0],
            "high": [69200.0, 70000.0],
            "low": [67500.0, 68500.0],
            "close": [68800.0, 69500.0],
            "volume": [1200.0, 1300.0],
        }
    )
    monkeypatch.setattr(
        market_api,
        "fetch_ohlcv_with_meta",
        lambda **kwargs: (
            frame,
            {"source": "live", "stale": False, "as_of": "2026-03-03T00:00:00+00:00", "provider": "yfinance"},
        ),
    )

    resp = asyncio.run(market_api.get_quote("BTC", db=None))

    assert resp["data"]["symbol"] == "BTC"
    assert resp["data"]["asset_type"] == "crypto"
    assert resp["data"]["price"] == 69500.0
    assert resp["meta"]["fetch_source"] == "ohlcv_live_fallback"


def test_market_search_uses_live_stock_symbols(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    def _mock_symbols_with_meta(market: str, limit: int, force_refresh: bool = False, allow_stale: bool = True):
        calls.append(
            {
                "market": market,
                "limit": limit,
                "force_refresh": force_refresh,
                "allow_stale": allow_stale,
            }
        )
        return (
            [
                {"symbol": "AAPL", "name": "Apple Inc.", "asset_type": "stock", "market": "US"},
                {"symbol": "MSFT", "name": "Microsoft", "asset_type": "stock", "market": "US"},
            ],
            {"source": "live", "stale": False, "as_of": "2026-03-12T00:00:00+00:00", "cache_age_sec": 0},
        )

    monkeypatch.setattr(market_api, "fetch_stock_symbols_with_meta", _mock_symbols_with_meta)

    resp = asyncio.run(market_api.search_assets(q="AAP", type="stock", limit=8, db=None))

    assert resp["data"][0]["symbol"] == "AAPL"
    assert resp["meta"]["source"] == "live"
    assert calls == [{"market": "all", "limit": 600, "force_refresh": True, "allow_stale": False}]


def test_market_top_movers_defaults_to_cache_friendly_snapshot(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    def _mock_snapshot_with_meta(market: str, limit: int, force_refresh: bool = False, allow_stale: bool = True):
        calls.append(
            {
                "market": market,
                "limit": limit,
                "force_refresh": force_refresh,
                "allow_stale": allow_stale,
            }
        )
        return (
            [
                {"symbol": "AAPL", "change_pct": 3.2, "last_price": 105.0},
                {"symbol": "MSFT", "change_pct": 2.5, "last_price": 210.0},
            ],
            {"source": "cache", "stale": False, "as_of": "2026-03-12T00:00:00+00:00", "cache_age_sec": 4},
        )

    monkeypatch.setattr(market_api, "fetch_stock_snapshot_with_meta", _mock_snapshot_with_meta)

    resp = asyncio.run(market_api.top_movers(type="stock", limit=2, force_refresh=False, allow_stale=False))

    assert resp["meta"]["source"] == "cache"
    assert resp["data"][0]["symbol"] == "AAPL"
    assert calls == [{"market": "all", "limit": 60, "force_refresh": False, "allow_stale": False}]


def test_market_batch_quotes_aggregates_rows_and_failures(monkeypatch) -> None:
    async def _mock_get_quote(symbol: str, db=None):
        if symbol == "AAPL":
            return {
                "data": {
                    "symbol": "AAPL",
                    "asset_type": "stock",
                    "price": 101.5,
                    "change_pct_24h": 1.2,
                    "as_of": "2026-03-12T00:00:00+00:00",
                },
                "meta": {
                    "source": "live",
                    "fetch_source": "yfinance",
                    "stale": False,
                },
            }
        raise HTTPException(
            status_code=502,
            detail=market_api._error("UPSTREAM_UNAVAILABLE", "Unable to fetch realtime price", {"symbol": symbol}),
        )

    monkeypatch.setattr(market_api, "get_quote", _mock_get_quote)
    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("crypto", "coinbase") if symbol == "BTC" else ("stock", "yfinance"))

    payload = market_api.BatchQuoteRequest(symbols=["AAPL", "BTC", "AAPL"])
    resp = asyncio.run(market_api.get_quotes(payload, db=None))

    assert resp["meta"]["count"] == 2
    assert resp["meta"]["success_count"] == 1
    assert resp["meta"]["failed_count"] == 1
    assert resp["meta"]["failed_symbols"] == ["BTC"]
    assert resp["data"][0]["symbol"] == "AAPL"
    assert resp["data"][0]["source"] == "live"
    assert resp["data"][1]["symbol"] == "BTC"
    assert resp["data"][1]["error"] == "Unable to fetch realtime price"
