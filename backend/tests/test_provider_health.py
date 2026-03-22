"""Tests for provider health summary logic."""

from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from app.services import provider_health


def _frame(rows: int) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=rows, freq="D", tz="UTC"),
            "open": [100.0] * rows,
            "high": [101.0] * rows,
            "low": [99.0] * rows,
            "close": [100.0] * rows,
            "volume": [1000.0] * rows,
        }
    )


def test_run_provider_health_check_reports_ok_and_degraded(monkeypatch) -> None:
    monkeypatch.setattr(
        provider_health,
        "fetch_stock_snapshot_with_meta",
        lambda market, limit, force_refresh=True, allow_stale=False: (
            [{"symbol": "AAPL"}],
            {"source": "live", "stale": False, "as_of": "2026-03-14T00:00:00+00:00", "cache_age_sec": 0},
        ),
    )
    monkeypatch.setattr(
        provider_health,
        "fetch_stock_symbols_with_meta",
        lambda market, limit, force_refresh=True, allow_stale=False: (
            [{"symbol": "AAPL"}],
            {"source": "live", "stale": False, "as_of": "2026-03-14T00:00:00+00:00", "cache_age_sec": 0},
        ),
    )

    def _mock_ohlcv(symbol: str, start_date: str, end_date: str, interval: str):
        if symbol == "AAPL":
            return _frame(20), {"provider": "yfinance", "fetch_source": "yfinance", "as_of": "2026-03-14T00:00:00+00:00"}
        return _frame(20), {"provider": "coinbase", "fetch_source": "openbb", "as_of": "2026-03-14T00:00:00+00:00"}

    monkeypatch.setattr(provider_health, "fetch_ohlcv_with_meta", _mock_ohlcv)
    monkeypatch.setattr(
        provider_health,
        "fetch_crypto_realtime_price",
        lambda symbols: {"BTC": {"price": 65000.0, "change_pct_24h": 2.5}},
    )

    payload = provider_health.run_provider_health_check(datetime(2026, 3, 14, tzinfo=timezone.utc))

    assert payload["summary"]["status"] == "degraded"
    assert payload["summary"]["ok_checks"] == 4
    assert payload["summary"]["degraded_checks"] == 1
    assert payload["summary"]["error_checks"] == 0
    degraded = next(item for item in payload["checks"] if item["name"] == "stock_ohlcv_aapl")
    assert degraded["status"] == "degraded"
    assert degraded["details"]["fetch_source"] == "yfinance"


def test_run_provider_health_check_reports_errors(monkeypatch) -> None:
    monkeypatch.setattr(
        provider_health,
        "fetch_stock_snapshot_with_meta",
        lambda market, limit, force_refresh=True, allow_stale=False: ([], {"source": "live", "stale": False}),
    )
    monkeypatch.setattr(
        provider_health,
        "fetch_stock_symbols_with_meta",
        lambda market, limit, force_refresh=True, allow_stale=False: ([], {"source": "live", "stale": False}),
    )
    monkeypatch.setattr(provider_health, "fetch_ohlcv_with_meta", lambda *args, **kwargs: (_frame(0), {"fetch_source": None}))
    monkeypatch.setattr(provider_health, "fetch_crypto_realtime_price", lambda symbols: {})

    payload = provider_health.run_provider_health_check(datetime(2026, 3, 14, tzinfo=timezone.utc))

    assert payload["summary"]["status"] == "error"
    assert payload["summary"]["error_checks"] == 5
