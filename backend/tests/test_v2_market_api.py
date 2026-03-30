"""Contract tests for v2 market date-bound routes."""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from app.api.v2 import market as market_v2

from tests._v2_testutils import FakeResult, QueueAsyncSession, make_client


def test_v2_market_northbound_parses_trade_date(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_v2, "_latest_available_cn_trade_date", lambda now_utc=None: date(2026, 3, 20))
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "trade_date": date(2026, 3, 20),
                        "market": "SH",
                        "net_buy": 123.4,
                        "buy_amount": 1000.0,
                        "sell_amount": 876.6,
                        "hold_amount": 8888.8,
                    }
                ]
            )
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/market/northbound", params={"date": "2026-03-20", "market": "sh"})

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["trade_date"] == "2026-03-20"
    assert payload["meta"]["source"] == "eod"
    assert payload["meta"]["stale"] is False
    assert payload["meta"]["as_of"].startswith("2026-03-20T15:00:00")
    assert session.calls[0]["params"]["trade_date"] == date(2026, 3, 20)
    assert session.calls[0]["params"]["market"] == "SH"


def test_v2_market_calendar_parses_date_window() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "id": 1,
                        "title": "Payrolls",
                        "event_type": "macro",
                        "event_date": date(2026, 3, 25),
                        "event_time": None,
                        "symbols": ["SPY"],
                        "markets": ["us"],
                        "importance": 4,
                    }
                ]
            )
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/market/calendar", params={"start": "2026-03-01", "end": "2026-03-31", "market": "us"})

    assert resp.status_code == 200
    assert resp.json()["meta"]["count"] == 1
    assert session.calls[0]["params"]["start_date"] == date(2026, 3, 1)
    assert session.calls[0]["params"]["end_date"] == date(2026, 3, 31)
    assert session.calls[0]["params"]["market"] == "us"


def test_v2_market_kline_intraday_live_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_v2, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(
        market_v2,
        "fetch_ohlcv_with_meta",
        lambda symbol, start_date, end_date, interval: (
            pd.DataFrame(
                {
                    "time": pd.to_datetime(["2026-03-25T09:30:00Z", "2026-03-25T09:35:00Z"], utc=True),
                    "open": [100.0, 101.0],
                    "high": [101.5, 102.0],
                    "low": [99.8, 100.7],
                    "close": [101.0, 101.8],
                    "volume": [1200.0, 1300.0],
                }
            ),
            {"source": "live", "stale": False, "as_of": "2026-03-25T09:35:00+00:00", "provider": "yfinance", "fetch_source": "yfinance"},
        ),
    )
    def _unexpected_v1_kline(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("v1 get_kline should not be used for intraday")

    monkeypatch.setattr(market_v2.market_v1, "get_kline", _unexpected_v1_kline)

    client = make_client(db_session=QueueAsyncSession([]))
    resp = client.get(
        "/api/v2/market/AAPL/kline",
        params={"period": "5m", "start": "2026-03-24", "end": "2026-03-25"},
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["period"] == "5m"
    assert payload["meta"]["source"] == "live"
    assert payload["meta"]["count"] == 2
    assert payload["data"][0]["open"] == 100.0


def test_v2_market_kline_intraday_returns_502_when_upstream_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(market_v2, "detect_provider", lambda symbol: ("crypto", "coingecko"))
    monkeypatch.setattr(market_v2, "fetch_ohlcv_with_meta", lambda symbol, start_date, end_date, interval: (pd.DataFrame(), {"source": "live"}))
    client = make_client(db_session=QueueAsyncSession([]))

    resp = client.get(
        "/api/v2/market/BTC/kline",
        params={"period": "1m", "start": "2026-03-24", "end": "2026-03-25"},
    )
    assert resp.status_code == 502
    assert resp.json()["detail"]["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_v2_market_financials_passes_report_type_and_period(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    def _fake_fetch_fundamentals(symbol: str, report_type: str = "income", period: str = "annual") -> pd.DataFrame:
        captured["symbol"] = symbol
        captured["report_type"] = report_type
        captured["period"] = period
        return pd.DataFrame(
            [
                {"report_date": "2024-09-30", "report_period": "Q3", "净利润": 100.0},
                {"report_date": "2024-06-30", "report_period": "Q2", "净利润": 80.0},
            ]
        )

    monkeypatch.setattr(market_v2, "fetch_fundamentals", _fake_fetch_fundamentals)

    client = make_client(db_session=QueueAsyncSession([]))
    resp = client.get(
        "/api/v2/market/600519.SH/financials",
        params={"report_type": "cashflow", "period": "quarterly", "limit": 1},
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert captured == {
        "symbol": "600519.SH",
        "report_type": "cashflow",
        "period": "quarterly",
    }
    assert payload["meta"]["report_type"] == "cashflow"
    assert payload["meta"]["period"] == "quarterly"
    assert payload["meta"]["count"] == 1
    assert payload["data"][0]["report_period"] == "Q3"
