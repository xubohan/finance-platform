"""Tests for screener market symbol source and numeric normalization."""

from __future__ import annotations

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
