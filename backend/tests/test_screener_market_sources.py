"""Tests for screener market symbol source and numeric normalization."""

from __future__ import annotations

from app.services.openbb_adapter import _parse_eastmoney_payload, _parse_sp500_constituents_csv, _to_number


def test_parse_sp500_constituents_csv_basic() -> None:
    csv_text = "Symbol,Security\nAAPL,Apple Inc.\nMSFT,Microsoft Corp\n"
    rows = _parse_sp500_constituents_csv(csv_text, limit=10)

    assert rows == [
        {"symbol": "AAPL", "name": "Apple Inc.", "asset_type": "stock", "market": "US"},
        {"symbol": "MSFT", "name": "Microsoft Corp", "asset_type": "stock", "market": "US"},
    ]


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
