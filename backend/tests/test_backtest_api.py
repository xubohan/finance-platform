"""Tests for backtest API batch lab behavior."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
import pandas as pd
import pytest

from app.api import backtest as backtest_api


def _snapshot_rows(count: int) -> list[dict]:
    rows: list[dict] = []
    for idx in range(1, count + 1):
        rows.append(
            {
                "symbol": f"US{idx:05d}",
                "name": f"Stock {idx}",
                "market": "US",
            }
        )
    return rows


def _ohlcv_rows() -> pd.DataFrame:
    base = datetime(2024, 1, 1, tzinfo=timezone.utc)
    times = [base + timedelta(days=i) for i in range(40)]
    close = [100 + i * 0.5 for i in range(40)]
    return pd.DataFrame(
        {
            "time": times,
            "open": close,
            "high": [v + 1 for v in close],
            "low": [v - 1 for v in close],
            "close": close,
            "volume": [10000] * 40,
        }
    )


def test_backtest_lab_full_universe_then_paginate(monkeypatch: pytest.MonkeyPatch) -> None:
    sample = _snapshot_rows(120)
    candles = _ohlcv_rows()

    def _mock_snapshot(
        market: str,
        limit: int,
        *,
        force_refresh: bool = True,
        allow_stale: bool = False,
    ) -> tuple[list[dict], dict]:
        assert market == "us"
        return sample[:limit], {"source": "live", "stale": False, "as_of": "2026-03-02T00:00:00+00:00", "cache_age_sec": 0}

    def _mock_run(self, df, symbol, asset_type):  # type: ignore[no-untyped-def]
        score = float(int(symbol[2:]))
        return {
            "metrics": {
                "total_return": score,
                "annual_return": score / 10,
                "sharpe_ratio": 1.2,
                "max_drawdown": 8.5,
                "win_rate": 55.0,
                "trade_count": 12,
            }
        }

    async def _mock_load_ohlcv_window(**kwargs):
        return (
            candles,
            {
                "source": "local",
                "sync_performed": False,
                "stale": False,
                "as_of": "2026-03-02T00:00:00+00:00",
            },
        )

    monkeypatch.setattr(backtest_api, "fetch_stock_snapshot_with_meta", _mock_snapshot)
    monkeypatch.setattr(backtest_api, "load_ohlcv_window", _mock_load_ohlcv_window)
    monkeypatch.setattr(
        backtest_api,
        "fetch_stock_universe_total_with_meta",
        lambda market, force_refresh=True, allow_stale=False: (
            6789,
            {"source": "live", "stale": False, "as_of": "2026-03-02T00:00:00+00:00", "cache_age_sec": 0},
        ),
    )
    monkeypatch.setattr(backtest_api.BacktestEngine, "run", _mock_run)

    payload = backtest_api.BacktestLabRequest(
        market="us",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
        symbol_limit=20000,
        page=2,
        page_size=50,
    )
    resp = asyncio.run(backtest_api.run_backtest_lab(payload))

    assert resp["meta"]["count"] == 50
    assert resp["meta"]["total_items"] == 120
    assert resp["meta"]["total_pages"] == 3
    assert resp["meta"]["page"] == 2
    assert resp["meta"]["page_size"] == 50
    assert resp["meta"]["market"] == "us"
    assert resp["meta"]["symbols_fetched"] == 120
    assert resp["meta"]["symbols_backtested"] == 120
    assert resp["meta"]["total_available"] == 6789
    assert resp["meta"]["source"] == "live"
    assert resp["meta"]["stale"] is False
    assert resp["meta"]["as_of"] == "2026-03-02T00:00:00+00:00"
    assert resp["meta"]["ohlcv_live_symbols"] == 0
    assert resp["meta"]["ohlcv_local_symbols"] == 120
    assert resp["meta"]["ohlcv_failed_symbols"] == 0
    assert resp["meta"]["ohlcv_local_fallback_symbols"] == 120
    assert len(resp["data"]) == 50
    assert resp["data"][0]["symbol"] == "US00070"


def test_backtest_lab_returns_502_when_live_source_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        backtest_api,
        "fetch_stock_snapshot_with_meta",
        lambda market, limit, force_refresh=True, allow_stale=False: ([], {"source": "live", "stale": False, "as_of": None, "cache_age_sec": None}),
    )

    payload = backtest_api.BacktestLabRequest(
        market="cn",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(backtest_api.run_backtest_lab(payload))

    assert exc.value.status_code == 502
    assert exc.value.detail["error"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_run_backtest_prefers_local_window(monkeypatch: pytest.MonkeyPatch) -> None:
    candles = _ohlcv_rows()

    async def _mock_load_ohlcv_window(**kwargs):
        return (
            candles,
            {
                "source": "local",
                "sync_performed": False,
                "stale": False,
                "as_of": "2026-03-02T00:00:00+00:00",
                "provider": "local",
                "fetch_source": "database",
                "coverage_complete": True,
            },
        )

    monkeypatch.setattr(backtest_api, "load_ohlcv_window", _mock_load_ohlcv_window)
    monkeypatch.setattr(
        backtest_api.BacktestEngine,
        "run",
        lambda self, df, symbol, asset_type: {"metrics": {"total_return": 10.0}, "equity_curve": [], "trades": []},
    )

    payload = backtest_api.BacktestRequest(
        symbol="aapl",
        asset_type="stock",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
    )
    resp = asyncio.run(backtest_api.run_backtest(payload))

    assert resp["meta"]["ohlcv_source"] == "local"
    assert resp["meta"]["sync_performed"] is False
    assert resp["meta"]["storage_source"] == "local"
    assert resp["meta"]["coverage_complete"] is True


def test_run_backtest_rejects_partial_local_window_when_auto_sync_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _mock_load_ohlcv_window(**kwargs):
        return (
            _ohlcv_rows().iloc[:5],
            {
                "source": "local",
                "sync_performed": False,
                "stale": False,
                "as_of": "2026-03-02T00:00:00+00:00",
                "provider": "local",
                "fetch_source": "database_partial",
                "coverage_complete": False,
            },
        )

    monkeypatch.setattr(backtest_api, "load_ohlcv_window", _mock_load_ohlcv_window)

    payload = backtest_api.BacktestRequest(
        symbol="aapl",
        asset_type="stock",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
        sync_if_missing=False,
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(backtest_api.run_backtest(payload))

    assert exc.value.status_code == 409
    assert exc.value.detail["error"]["code"] == "LOCAL_DATA_INCOMPLETE"


def test_run_backtest_rejects_invalid_date_format() -> None:
    payload = backtest_api.BacktestRequest(
        symbol="AAPL",
        asset_type="stock",
        strategy_name="ma_cross",
        parameters={"fast": 5, "slow": 20},
        start_date="invalid-date",
        end_date="2024-12-31",
        initial_capital=1_000_000,
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(backtest_api.run_backtest(payload))

    assert exc.value.status_code == 400
    assert exc.value.detail["error"]["code"] == "INVALID_DATE_FORMAT"


def test_list_backtest_strategies_returns_catalog_metadata() -> None:
    resp = asyncio.run(backtest_api.list_backtest_strategies())

    assert resp["meta"]["count"] == len(backtest_api.SUPPORTED_STRATEGY_NAMES)
    first = resp["data"][0]
    assert first["name"] == "ma_cross"
    assert first["label"] == "MA Cross"
    assert first["parameter_mode"] == "fast_slow"
    assert isinstance(first["summary"], str) and first["summary"]


def test_compare_backtest_strategies_sorts_rows_by_total_return(monkeypatch: pytest.MonkeyPatch) -> None:
    candles = _ohlcv_rows()

    async def _mock_load_ohlcv_window(**kwargs):
        return (
            candles,
            {
                "source": "local",
                "sync_performed": False,
                "stale": False,
                "as_of": "2026-03-02T00:00:00+00:00",
                "provider": "local",
                "fetch_source": "database",
                "coverage_complete": True,
            },
        )

    score_map = {
        "BuyHoldStrategy": 8.0,
        "MACrossStrategy": 12.0,
        "EMACrossStrategy": 10.0,
    }

    def _mock_run(self, df, symbol, asset_type):  # type: ignore[no-untyped-def]
        total_return = score_map.get(self.strategy.__class__.__name__, 0.0)
        return {
            "metrics": {
                "total_return": total_return,
                "annual_return": total_return / 2,
                "sharpe_ratio": 1.0,
                "max_drawdown": -5.0,
                "win_rate": 50.0,
                "trade_count": 4,
            }
        }

    monkeypatch.setattr(backtest_api, "load_ohlcv_window", _mock_load_ohlcv_window)
    monkeypatch.setattr(backtest_api.BacktestEngine, "run", _mock_run)

    payload = backtest_api.BacktestCompareRequest(
        symbol="AAPL",
        asset_type="stock",
        strategy_names=["buy_hold", "ema_cross", "ma_cross"],
        parameters_by_strategy={"ema_cross": {"fast": 8, "slow": 21}},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
    )

    resp = asyncio.run(backtest_api.compare_backtest_strategies(payload))

    assert resp["meta"]["count"] == 3
    assert resp["meta"]["ohlcv_source"] == "local"
    assert [row["strategy_name"] for row in resp["data"]] == ["ma_cross", "ema_cross", "buy_hold"]
    assert resp["meta"]["ranking_metric"] == "total_return"


def test_compare_backtest_strategies_sorts_rows_by_lowest_drawdown(monkeypatch: pytest.MonkeyPatch) -> None:
    candles = _ohlcv_rows()

    async def _mock_load_ohlcv_window(**kwargs):
        return (
            candles,
            {
                "source": "local",
                "sync_performed": False,
                "stale": False,
                "as_of": "2026-03-02T00:00:00+00:00",
                "provider": "local",
                "fetch_source": "database",
                "coverage_complete": True,
            },
        )

    score_map = {
        "BuyHoldStrategy": 8.0,
        "MACrossStrategy": 12.0,
        "EMACrossStrategy": 10.0,
    }
    drawdown_map = {
        "BuyHoldStrategy": 12.0,
        "MACrossStrategy": 4.0,
        "EMACrossStrategy": 7.0,
    }

    def _mock_run(self, df, symbol, asset_type):  # type: ignore[no-untyped-def]
        strategy_type = self.strategy.__class__.__name__
        total_return = score_map.get(strategy_type, 0.0)
        max_drawdown = drawdown_map.get(strategy_type, 0.0)
        return {
            "metrics": {
                "total_return": total_return,
                "annual_return": total_return / 2,
                "sharpe_ratio": 1.0,
                "max_drawdown": max_drawdown,
                "win_rate": 50.0,
                "trade_count": 4,
            }
        }

    monkeypatch.setattr(backtest_api, "load_ohlcv_window", _mock_load_ohlcv_window)
    monkeypatch.setattr(backtest_api.BacktestEngine, "run", _mock_run)

    payload = backtest_api.BacktestCompareRequest(
        symbol="AAPL",
        asset_type="stock",
        strategy_names=["buy_hold", "ema_cross", "ma_cross"],
        parameters_by_strategy={"ema_cross": {"fast": 8, "slow": 21}},
        start_date="2024-01-01",
        end_date="2024-12-31",
        initial_capital=1_000_000,
        ranking_metric="max_drawdown",
    )

    resp = asyncio.run(backtest_api.compare_backtest_strategies(payload))

    assert resp["meta"]["ranking_metric"] == "max_drawdown"
    assert [row["strategy_name"] for row in resp["data"]] == ["ma_cross", "ema_cross", "buy_hold"]


@pytest.mark.parametrize(
    ("strategy_name", "parameters", "strategy_type"),
    [
        ("buy_hold", {}, "BuyHoldStrategy"),
        ("ema_cross", {"fast": 8, "slow": 21}, "EMACrossStrategy"),
        ("alma_cross", {"fast": 9, "slow": 21}, "ALMACrossStrategy"),
        ("lsma_cross", {"fast": 9, "slow": 21}, "LSMACrossStrategy"),
        ("mcginley_cross", {"fast": 8, "slow": 21}, "McGinleyCrossStrategy"),
        ("t3_cross", {"fast": 5, "slow": 20}, "T3CrossStrategy"),
        ("trima_cross", {"fast": 5, "slow": 20}, "TRIMACrossStrategy"),
        ("smma_cross", {"fast": 5, "slow": 20}, "SMMACrossStrategy"),
        ("vwma_cross", {"fast": 5, "slow": 20}, "VWMACrossStrategy"),
        ("dema_cross", {"fast": 5, "slow": 20}, "DEMACrossStrategy"),
        ("zlema_cross", {"fast": 5, "slow": 20}, "ZLEMACrossStrategy"),
        ("tema_cross", {"fast": 5, "slow": 20}, "TEMACrossStrategy"),
        ("wma_cross", {"fast": 5, "slow": 20}, "WMACrossStrategy"),
        ("hma_cross", {"fast": 9, "slow": 21}, "HMACrossStrategy"),
        ("stochastic_reversal", {"period": 14, "oversold": 20, "overbought": 80}, "StochasticReversalStrategy"),
        ("bias_reversal", {"period": 14, "oversold": -5, "overbought": 5}, "BIASReversalStrategy"),
        ("demarker_reversal", {"period": 14, "oversold": 30, "overbought": 70}, "DeMarkerReversalStrategy"),
        ("cfo_reversal", {"period": 14, "oversold": -2, "overbought": 2}, "CFOReversalStrategy"),
        ("smi_reversal", {"period": 14, "oversold": -40, "overbought": 40}, "SMIReversalStrategy"),
        ("awesome_reversal", {"period": 14, "oversold": -1, "overbought": 1}, "AwesomeReversalStrategy"),
        ("schaff_reversal", {"period": 14, "oversold": 25, "overbought": 75}, "SchaffReversalStrategy"),
        ("ultimate_oscillator_reversal", {"period": 7, "oversold": 30, "overbought": 70}, "UltimateOscillatorReversalStrategy"),
        ("stochrsi_reversal", {"period": 14, "oversold": 20, "overbought": 80}, "StochRSIReversalStrategy"),
        ("rvi_reversal", {"period": 10, "oversold": -0.2, "overbought": 0.2}, "RVIReversalStrategy"),
        ("mfi_reversal", {"period": 14, "oversold": 20, "overbought": 80}, "MFIReversalStrategy"),
        ("cmo_reversal", {"period": 14, "oversold": -50, "overbought": 50}, "CMOReversalStrategy"),
        ("dpo_reversal", {"period": 20, "oversold": -2, "overbought": 2}, "DPOReversalStrategy"),
        ("fisher_reversal", {"period": 10, "oversold": -1.5, "overbought": 1.5}, "FisherReversalStrategy"),
        ("supertrend_follow", {"period": 10, "multiplier": 2.0}, "SupertrendFollowStrategy"),
        ("adx_trend", {"period": 14, "threshold": 25}, "ADXTrendStrategy"),
        ("keltner_reversion", {"period": 20, "multiplier": 1.5}, "KeltnerReversionStrategy"),
        ("vwap_reversion", {"period": 20, "deviation_pct": 3.0}, "VWAPReversionStrategy"),
        ("atr_breakout", {"period": 14, "multiplier": 2.0}, "ATRBreakoutStrategy"),
        ("cci_reversal", {"period": 20, "oversold": -100, "overbought": 100}, "CCIReversalStrategy"),
        ("obv_trend", {"fast": 8, "slow": 21}, "OBVTrendStrategy"),
        ("dmi_breakout", {"period": 14, "threshold": 25}, "DMIBreakoutStrategy"),
        ("chaikin_reversal", {"fast": 3, "slow": 10}, "ChaikinReversalStrategy"),
        ("williams_reversal", {"period": 14, "oversold": -80, "overbought": -20}, "WilliamsReversalStrategy"),
        ("chaikin_money_flow_trend", {"period": 20, "threshold": 0.05}, "ChaikinMoneyFlowTrendStrategy"),
        ("chaikin_volatility_trend", {"period": 10, "threshold": 10}, "ChaikinVolatilityTrendStrategy"),
        ("aroon_trend", {"period": 25, "threshold": 70}, "AroonTrendStrategy"),
        ("efi_trend", {"period": 13, "threshold": 1000}, "EFITrendStrategy"),
        ("vzo_trend", {"period": 14, "threshold": 15}, "VZOTrendStrategy"),
        ("vhf_trend", {"period": 14, "threshold": 0.4}, "VHFTrendStrategy"),
        ("kst_trend", {"period": 10, "threshold": 5}, "KSTTrendStrategy"),
        ("pmo_trend", {"period": 12, "threshold": 0.5}, "PMOTrendStrategy"),
        ("roc_breakout", {"period": 12, "threshold": 5}, "ROCBreakoutStrategy"),
        ("linreg_slope_trend", {"period": 14, "threshold": 0.3}, "LinRegSlopeTrendStrategy"),
        ("trix_trend", {"period": 15, "threshold": 0.2}, "TrixTrendStrategy"),
        ("tsi_trend", {"period": 13, "threshold": 10}, "TSITrendStrategy"),
        ("coppock_trend", {"period": 14, "threshold": 0.5}, "CoppockTrendStrategy"),
        ("vortex_trend", {"period": 14, "threshold": 0.1}, "VortexTrendStrategy"),
        ("bollinger_reversion", {"period": 20, "stddev": 2.5}, "BollingerReversionStrategy"),
        ("donchian_breakout", {"lookback": 20, "exit_lookback": 10}, "DonchianBreakoutStrategy"),
    ],
)
def test_build_strategy_supports_new_methods(strategy_name: str, parameters: dict[str, float], strategy_type: str) -> None:
    strategy = backtest_api._build_strategy(strategy_name, parameters)
    assert strategy.__class__.__name__ == strategy_type
