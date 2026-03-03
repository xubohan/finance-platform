"""Tests for strict real-time defaults on API request schemas."""

from __future__ import annotations

from app.api.backtest import BacktestLabRequest
from app.api.factors import FactorScoreRequest, FactorWeights
from app.api.screener import ScreenerRequest


def test_screener_request_defaults_to_force_refresh_and_no_stale() -> None:
    payload = ScreenerRequest()
    assert payload.force_refresh is True
    assert payload.allow_stale is False


def test_factors_request_defaults_to_force_refresh_and_no_stale() -> None:
    payload = FactorScoreRequest(weights=FactorWeights())
    assert payload.force_refresh is True
    assert payload.allow_stale is False


def test_backtest_lab_request_defaults_to_force_refresh_and_no_stale() -> None:
    payload = BacktestLabRequest(
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="2024-01-01",
        end_date="2024-12-31",
    )
    assert payload.force_refresh is True
    assert payload.allow_stale is False
