"""Tests for screener fallback filtering behavior."""

from __future__ import annotations

from app.api.screener import ScreenerRequest, _filter_fallback_rows


def test_screener_fallback_filters_follow_payload_thresholds() -> None:
    payload = ScreenerRequest(min_pe=20, max_pe=35, min_roe=25, min_profit_yoy=10, limit=50)
    rows = _filter_fallback_rows(payload)

    assert rows
    assert all(20 <= float(r["pe_ttm"]) <= 35 for r in rows)
    assert all(float(r["roe"]) >= 25 for r in rows)
    assert all(float(r["profit_yoy"]) >= 10 for r in rows)


def test_screener_fallback_sorts_by_roe_desc_and_applies_limit() -> None:
    payload = ScreenerRequest(limit=3)
    rows = _filter_fallback_rows(payload)

    assert len(rows) == 3
    roes = [float(r["roe"]) for r in rows]
    assert roes == sorted(roes, reverse=True)
