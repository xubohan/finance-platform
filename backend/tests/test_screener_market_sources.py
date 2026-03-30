"""Tests for screener market symbol source and numeric normalization."""

from __future__ import annotations

import pandas as pd

from app.services import openbb_adapter
from app.services.openbb_adapter import _parse_eastmoney_payload, _to_number


def test_parse_eastmoney_payload_maps_exchange_suffix() -> None:
    payload = {
        "data": {
            "diff": [
                {"f12": "600000", "f14": "SPD Bank"},
                {"f12": "300750", "f14": "CATL"},
            ]
        }
    }
    rows = _parse_eastmoney_payload(payload, limit=10)

    assert rows == [
        {"symbol": "600000.SH", "name": "SPD Bank", "asset_type": "stock", "market": "CN"},
        {"symbol": "300750.SZ", "name": "CATL", "asset_type": "stock", "market": "CN"},
    ]


def test_to_number_handles_placeholder_and_numeric_values() -> None:
    assert _to_number("12.5") == 12.5
    assert _to_number("-") is None
    assert _to_number(None) is None


def test_snapshot_returns_empty_when_live_feed_unavailable(monkeypatch) -> None:
    def _boom(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("upstream unavailable")

    monkeypatch.setattr(openbb_adapter, "_fetch_nasdaq_snapshot", _boom)
    monkeypatch.setattr(openbb_adapter, "_fetch_sina_cn_snapshot", _boom)
    monkeypatch.setattr(openbb_adapter, "_fetch_eastmoney_snapshot", _boom)

    assert openbb_adapter.fetch_stock_snapshot("us", 30) == []
    assert openbb_adapter.fetch_stock_snapshot("cn", 30) == []
    assert openbb_adapter.fetch_stock_snapshot("all", 30) == []
    assert openbb_adapter.fetch_stock_symbols("all", 30) == []


def test_fetch_stock_universe_total_by_market(monkeypatch) -> None:
    monkeypatch.setattr(openbb_adapter, "_fetch_nasdaq_total", lambda: 100)
    monkeypatch.setattr(openbb_adapter, "_fetch_sina_cn_total", lambda: 200)

    assert openbb_adapter.fetch_stock_universe_total("us", force_refresh=True, allow_stale=False) == 100
    assert openbb_adapter.fetch_stock_universe_total("cn", force_refresh=True, allow_stale=False) == 200
    assert openbb_adapter.fetch_stock_universe_total("all", force_refresh=True, allow_stale=False) == 300


def test_fetch_ohlcv_with_meta_marks_yfinance_stock_intraday_as_delayed(monkeypatch) -> None:
    monkeypatch.setattr(openbb_adapter, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(
        openbb_adapter,
        "_fetch_ohlcv_yfinance",
        lambda symbol, provider, start_date, end_date, interval: pd.DataFrame(
            {
                "time": pd.to_datetime(["2026-03-25T09:30:00Z", "2026-03-25T09:35:00Z"], utc=True),
                "open": [100.0, 101.0],
                "high": [101.0, 102.0],
                "low": [99.0, 100.5],
                "close": [100.8, 101.6],
                "volume": [1000.0, 1200.0],
            }
        ),
    )

    frame, meta = openbb_adapter.fetch_ohlcv_with_meta("AAPL", "2026-03-24", "2026-03-25", "5m")

    assert len(frame) == 2
    assert meta["source"] == "delayed"
    assert meta["stale"] is True
    assert meta["fetch_source"] == "yfinance"
    assert meta["as_of"] == "2026-03-25T09:35:00+00:00"


def test_fetch_ohlcv_with_meta_prefers_twelvedata_for_stock_daily(monkeypatch) -> None:
    monkeypatch.setattr(openbb_adapter, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(openbb_adapter.settings, "twelvedata_api_key", "demo")
    monkeypatch.setattr(openbb_adapter.settings, "stock_ohlcv_provider_order", "twelvedata,yfinance,stooq")
    monkeypatch.setattr(
        openbb_adapter,
        "_fetch_ohlcv_twelvedata_daily",
        lambda symbol, start_date, end_date: pd.DataFrame(
            {
                "time": pd.to_datetime(["2026-03-26T00:00:00Z", "2026-03-27T00:00:00Z"], utc=True),
                "open": [250.0, 253.9],
                "high": [253.0, 255.49],
                "low": [249.7, 248.07],
                "close": [252.89, 248.8],
                "volume": [39400000.0, 47842500.0],
            }
        ),
    )

    frame, meta = openbb_adapter.fetch_ohlcv_with_meta("AAPL", "2026-03-01", "2026-03-28", "1d")

    assert len(frame) == 2
    assert meta["source"] == "live"
    assert meta["stale"] is False
    assert meta["fetch_source"] == "twelvedata"
    assert meta["as_of"] == "2026-03-27T00:00:00+00:00"
