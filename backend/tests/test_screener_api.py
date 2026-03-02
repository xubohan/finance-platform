"""Tests for screener API name normalization and filtering behavior."""

from __future__ import annotations

from app.api.screener import MAX_ASSET_NAME_LEN, ScreenerRequest, _build_live_rows, _compact_asset_name


def test_compact_asset_name_abbreviates_long_us_security_name() -> None:
    long_name = (
        "First Busey Corporation Depositary Shares, Each Representing a 1/40thInterest in a Share of "
        "8.25% Fixed-Rate Series B Non-Cumulative Perpetual Preferred Stock, $0.001 par value"
    )

    compact = _compact_asset_name(long_name, "BUSEP", "US")

    assert compact == "First Busey Corp DS"
    assert len(compact) <= MAX_ASSET_NAME_LEN


def test_compact_asset_name_keeps_cn_name() -> None:
    assert _compact_asset_name(" 浦发银行 ", "600000.SH", "CN") == "浦发银行"


def test_build_live_rows_uses_compact_name_for_us() -> None:
    rows = [
        {
            "symbol": "BUSEP",
            "name": (
                "First Busey Corporation Depositary Shares, Each Representing a 1/40thInterest in a Share of "
                "8.25% Fixed-Rate Series B Non-Cumulative Perpetual Preferred Stock, $0.001 par value"
            ),
            "market": "US",
            "pe_ttm": 12.3,
            "roe": 8.6,
            "profit_yoy": 2.1,
        }
    ]
    payload = ScreenerRequest(market="us")

    out = _build_live_rows(rows, payload)

    assert len(out) == 1
    assert out[0]["name"] == "First Busey Corp DS"
    assert len(out[0]["name"]) <= MAX_ASSET_NAME_LEN

