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


def test_run_provider_health_check_reports_ok_when_core_sources_return_data(monkeypatch) -> None:
    monkeypatch.setattr(provider_health.settings, "twelvedata_api_key", "demo")
    monkeypatch.setattr(provider_health.settings, "alphavantage_api_key", "")
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
            return _frame(20), {
                "provider": "twelvedata",
                "fetch_source": "twelvedata",
                "source": "live",
                "stale": False,
                "as_of": "2026-03-14T00:00:00+00:00",
            }
        return _frame(20), {
            "provider": "coinbase",
            "fetch_source": "coinbase",
            "source": "live",
            "stale": False,
            "as_of": "2026-03-14T00:00:00+00:00",
        }

    monkeypatch.setattr(provider_health, "fetch_ohlcv_with_meta", _mock_ohlcv)
    monkeypatch.setattr(
        provider_health,
        "fetch_crypto_realtime_price",
        lambda symbols: {"BTC": {"price": 65000.0, "change_pct_24h": 2.5, "source": "live", "stale": False}},
    )
    monkeypatch.setattr(
        provider_health,
        "fetch_stock_realtime_price",
        lambda symbols: {
            "AAPL": {
                "price": 201.5,
                "change_pct_24h": 1.1,
                "provider": "twelvedata",
                "fetch_source": "twelvedata",
                "source": "live",
                "stale": False,
            }
        },
    )

    payload = provider_health.run_provider_health_check(datetime(2026, 3, 14, tzinfo=timezone.utc))

    assert payload["summary"]["status"] == "ok"
    assert payload["summary"]["ok_checks"] == 6
    assert payload["summary"]["degraded_checks"] == 0
    assert payload["summary"]["error_checks"] == 0
    stock_quote_check = next(item for item in payload["checks"] if item["name"] == "stock_quote_aapl")
    assert stock_quote_check["status"] == "ok"
    assert stock_quote_check["details"]["provider"] == "twelvedata"
    stock_check = next(item for item in payload["checks"] if item["name"] == "stock_ohlcv_aapl")
    assert stock_check["status"] == "ok"
    assert stock_check["details"]["fetch_source"] == "twelvedata"


def test_run_provider_health_check_reports_errors(monkeypatch) -> None:
    monkeypatch.setattr(provider_health.settings, "twelvedata_api_key", "demo")
    monkeypatch.setattr(provider_health.settings, "alphavantage_api_key", "")
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
    monkeypatch.setattr(provider_health, "fetch_stock_realtime_price", lambda symbols: {})

    payload = provider_health.run_provider_health_check(datetime(2026, 3, 14, tzinfo=timezone.utc))

    assert payload["summary"]["status"] == "error"
    assert payload["summary"]["error_checks"] == 6


def test_run_provider_health_check_marks_yfinance_stock_quote_degraded_without_keyed_providers(monkeypatch) -> None:
    monkeypatch.setattr(provider_health.settings, "twelvedata_api_key", "")
    monkeypatch.setattr(provider_health.settings, "alphavantage_api_key", "")
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
    monkeypatch.setattr(
        provider_health,
        "fetch_ohlcv_with_meta",
        lambda symbol, *args, **kwargs: (
            _frame(20),
            {
                "provider": "yfinance" if symbol == "AAPL" else "coinbase",
                "fetch_source": "yfinance" if symbol == "AAPL" else "coinbase",
                "source": "eod" if symbol == "AAPL" else "live",
                "stale": symbol == "AAPL",
                "as_of": "2026-03-14T00:00:00+00:00",
            },
        ),
    )
    monkeypatch.setattr(
        provider_health,
        "fetch_crypto_realtime_price",
        lambda symbols: {"BTC": {"price": 65000.0, "change_pct_24h": 2.5, "source": "live", "stale": False}},
    )
    monkeypatch.setattr(
        provider_health,
        "fetch_stock_realtime_price",
        lambda symbols: {
            "AAPL": {
                "price": 201.5,
                "change_pct_24h": 1.1,
                "provider": "yfinance",
                "fetch_source": "yfinance",
                "source": "delayed",
                "stale": True,
            }
        },
    )

    payload = provider_health.run_provider_health_check(datetime(2026, 3, 14, tzinfo=timezone.utc))

    assert payload["summary"]["status"] == "degraded"
    assert payload["summary"]["ok_checks"] == 4
    assert payload["summary"]["degraded_checks"] == 2
    stock_quote_check = next(item for item in payload["checks"] if item["name"] == "stock_quote_aapl")
    assert stock_quote_check["status"] == "degraded"
    assert stock_quote_check["details"]["provider"] == "yfinance"
