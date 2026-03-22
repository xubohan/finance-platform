"""Backtest engine high-value tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from backtest.strategies.aroon_trend import AroonTrendStrategy
from backtest.engine import BacktestEngine
from backtest.strategies.adx_trend import ADXTrendStrategy
from backtest.strategies.alma_cross import ALMACrossStrategy
from backtest.strategies.awesome_reversal import AwesomeReversalStrategy
from backtest.strategies.bias_reversal import BIASReversalStrategy
from backtest.strategies.atr_breakout import ATRBreakoutStrategy
from backtest.strategies.bollinger_reversion import BollingerReversionStrategy
from backtest.strategies.buy_hold import BuyHoldStrategy
from backtest.strategies.chaikin_volatility_trend import ChaikinVolatilityTrendStrategy
from backtest.strategies.chaikin_money_flow_trend import ChaikinMoneyFlowTrendStrategy
from backtest.strategies.chaikin_reversal import ChaikinReversalStrategy
from backtest.strategies.cci_reversal import CCIReversalStrategy
from backtest.strategies.cfo_reversal import CFOReversalStrategy
from backtest.strategies.cmo_reversal import CMOReversalStrategy
from backtest.strategies.coppock_trend import CoppockTrendStrategy
from backtest.strategies.dema_cross import DEMACrossStrategy
from backtest.strategies.demarker_reversal import DeMarkerReversalStrategy
from backtest.strategies.dmi_breakout import DMIBreakoutStrategy
from backtest.strategies.donchian_breakout import DonchianBreakoutStrategy
from backtest.strategies.dpo_reversal import DPOReversalStrategy
from backtest.strategies.ema_cross import EMACrossStrategy
from backtest.strategies.efi_trend import EFITrendStrategy
from backtest.strategies.fisher_reversal import FisherReversalStrategy
from backtest.strategies.hma_cross import HMACrossStrategy
from backtest.strategies.keltner_reversion import KeltnerReversionStrategy
from backtest.strategies.kst_trend import KSTTrendStrategy
from backtest.strategies.lsma_cross import LSMACrossStrategy
from backtest.strategies.linreg_slope_trend import LinRegSlopeTrendStrategy
from backtest.strategies.ma_cross import MACrossStrategy
from backtest.strategies.mfi_reversal import MFIReversalStrategy
from backtest.strategies.mcginley_cross import McGinleyCrossStrategy
from backtest.strategies.obv_trend import OBVTrendStrategy
from backtest.strategies.pmo_trend import PMOTrendStrategy
from backtest.strategies.roc_breakout import ROCBreakoutStrategy
from backtest.strategies.rvi_reversal import RVIReversalStrategy
from backtest.strategies.schaff_reversal import SchaffReversalStrategy
from backtest.strategies.smma_cross import SMMACrossStrategy
from backtest.strategies.smi_reversal import SMIReversalStrategy
from backtest.strategies.stochrsi_reversal import StochRSIReversalStrategy
from backtest.strategies.stochastic_reversal import StochasticReversalStrategy
from backtest.strategies.supertrend_follow import SupertrendFollowStrategy
from backtest.strategies.t3_cross import T3CrossStrategy
from backtest.strategies.tema_cross import TEMACrossStrategy
from backtest.strategies.trima_cross import TRIMACrossStrategy
from backtest.strategies.trix_trend import TrixTrendStrategy
from backtest.strategies.tsi_trend import TSITrendStrategy
from backtest.strategies.ultimate_oscillator_reversal import UltimateOscillatorReversalStrategy
from backtest.strategies.vhf_trend import VHFTrendStrategy
from backtest.strategies.vzo_trend import VZOTrendStrategy
from backtest.strategies.vwma_cross import VWMACrossStrategy
from backtest.strategies.vwap_reversion import VWAPReversionStrategy
from backtest.strategies.vortex_trend import VortexTrendStrategy
from backtest.strategies.williams_reversal import WilliamsReversalStrategy
from backtest.strategies.wma_cross import WMACrossStrategy
from backtest.strategies.zlema_cross import ZLEMACrossStrategy


def _sample_df(rows: int = 120) -> pd.DataFrame:
    base = datetime(2023, 1, 1, tzinfo=timezone.utc)
    times = [base + timedelta(days=i) for i in range(rows)]

    # Regime shift creates both buy and sell opportunities for MA cross.
    first = np.linspace(100, 140, rows // 2)
    second = np.linspace(140, 95, rows - rows // 2)
    close = np.concatenate([first, second])

    return pd.DataFrame(
        {
            "time": times,
            "open": close - 1,
            "high": close + 2,
            "low": close - 2,
            "close": close,
            "volume": np.linspace(1000, 3000, rows),
        }
    )


def test_backtest_runs_and_outputs_metrics() -> None:
    df = _sample_df()
    engine = BacktestEngine(strategy=MACrossStrategy(fast=5, slow=20), initial_capital=100000)
    result = engine.run(df, symbol="AAPL", asset_type="stock")

    assert "equity_curve" in result and len(result["equity_curve"]) == len(df)
    assert "metrics" in result
    assert set(["total_return", "annual_return", "sharpe_ratio", "max_drawdown", "win_rate", "trade_count"]).issubset(
        result["metrics"].keys()
    )


def test_backtest_contains_only_past_data_in_strategy_call() -> None:
    class LeakGuardStrategy(MACrossStrategy):
        def generate_signal(self, partial_df: pd.DataFrame) -> int:
            # Execution bar itself must not be visible to the strategy.
            assert len(partial_df) < len(df)
            return super().generate_signal(partial_df)

    df = _sample_df()
    engine = BacktestEngine(strategy=LeakGuardStrategy(fast=5, slow=20), initial_capital=100000)
    result = engine.run(df, symbol="AAPL", asset_type="stock")

    assert len(result["equity_curve"]) == len(df)


def test_backtest_executes_on_next_bar_open() -> None:
    class StepStrategy:
        def generate_signal(self, partial_df: pd.DataFrame) -> int:
            if len(partial_df) == 2:
                return 1
            if len(partial_df) == 3:
                return -1
            return 0

    df = pd.DataFrame(
        {
            "time": pd.to_datetime(["2023-01-01", "2023-01-02", "2023-01-03", "2023-01-04"], utc=True),
            "open": [100.0, 110.0, 120.0, 130.0],
            "high": [101.0, 111.0, 121.0, 131.0],
            "low": [99.0, 109.0, 119.0, 129.0],
            "close": [105.0, 115.0, 125.0, 135.0],
            "volume": [1000.0, 1000.0, 1000.0, 1000.0],
        }
    )

    engine = BacktestEngine(strategy=StepStrategy(), initial_capital=100000)
    result = engine.run(df, symbol="AAPL", asset_type="stock")

    assert [trade["price"] for trade in result["trades"]] == [120.0, 130.0]


def test_buy_hold_strategy_buys_once_and_keeps_position() -> None:
    df = _sample_df(rows=30)
    engine = BacktestEngine(strategy=BuyHoldStrategy(), initial_capital=100000)
    result = engine.run(df, symbol="AAPL", asset_type="stock")

    assert len(result["trades"]) == 1
    assert result["trades"][0]["action"] == "buy"
    assert result["equity_curve"][-1]["value"] != 100000
    assert result["metrics"]["trade_count"] == 0


def test_bollinger_reversion_and_donchian_breakout_emit_buy_signals() -> None:
    bollinger_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100] * 25,
            "high": [101] * 25,
            "low": [95] * 25,
            "close": [100] * 24 + [90],
            "volume": [1000] * 25,
        }
    )
    donchian_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100 + i for i in range(25)],
            "high": [101 + i for i in range(25)],
            "low": [99 + i for i in range(25)],
            "close": [100 + i for i in range(25)],
            "volume": [1000] * 25,
        }
    )

    assert BollingerReversionStrategy(period=20, stddev=2.0).generate_signal(bollinger_df) == 1
    assert DonchianBreakoutStrategy(lookback=20, exit_lookback=10).generate_signal(donchian_df) == 1


def test_ema_cross_stochastic_and_mfi_reversal_emit_buy_signals() -> None:
    ema_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=30, freq="D", tz="UTC"),
            "open": [100] * 29 + [140],
            "high": [101] * 29 + [141],
            "low": [99] * 29 + [139],
            "close": [100] * 29 + [140],
            "volume": [1000] * 30,
        }
    )
    oscillator_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=20, freq="D", tz="UTC"),
            "open": [100] * 20,
            "high": [101] * 19 + [101],
            "low": [99] * 19 + [90],
            "close": [100] * 19 + [91],
            "volume": [1000] * 19 + [4000],
        }
    )

    assert EMACrossStrategy(fast=5, slow=12).generate_signal(ema_df) == 1
    assert StochasticReversalStrategy(period=14, oversold=20, overbought=80).generate_signal(oscillator_df) == 1
    assert MFIReversalStrategy(period=14, oversold=20, overbought=80).generate_signal(oscillator_df) == 1


def test_supertrend_adx_and_keltner_emit_buy_signals() -> None:
    trend_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100] * 24 + [120],
            "high": [101] * 24 + [141],
            "low": [99] * 24 + [100],
            "close": [100] * 24 + [140],
            "volume": [1000] * 25,
        }
    )
    adx_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100 + i for i in range(25)],
            "high": [101 + i for i in range(25)],
            "low": [99 + i for i in range(25)],
            "close": [100.5 + i for i in range(25)],
            "volume": [1000] * 25,
        }
    )
    reversion_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100] * 24 + [90],
            "high": [101] * 24 + [91],
            "low": [99] * 24 + [80],
            "close": [100] * 24 + [82],
            "volume": [1000] * 25,
        }
    )

    assert SupertrendFollowStrategy(period=10, multiplier=2.0).generate_signal(trend_df) == 1
    assert ADXTrendStrategy(period=10, threshold=20).generate_signal(adx_df) == 1
    assert KeltnerReversionStrategy(period=10, multiplier=1.5).generate_signal(reversion_df) == 1


def test_vwap_atr_and_cci_emit_buy_signals() -> None:
    vwap_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100] * 24 + [90],
            "high": [101] * 24 + [92],
            "low": [99] * 24 + [88],
            "close": [100] * 24 + [89],
            "volume": [1000] * 24 + [5000],
        }
    )
    atr_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100] * 24 + [140],
            "high": [101] * 24 + [160],
            "low": [99] * 24 + [120],
            "close": [100] * 24 + [158],
            "volume": [1000] * 25,
        }
    )
    cci_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100] * 24 + [88],
            "high": [101] * 24 + [89],
            "low": [99] * 24 + [70],
            "close": [100] * 24 + [72],
            "volume": [1000] * 25,
        }
    )

    assert VWAPReversionStrategy(period=10, deviation_pct=3.0).generate_signal(vwap_df) == 1
    assert ATRBreakoutStrategy(period=10, multiplier=1.0).generate_signal(atr_df) == 1
    assert CCIReversalStrategy(period=10, oversold=-100, overbought=100).generate_signal(cci_df) == 1


def test_obv_dmi_and_chaikin_emit_buy_signals() -> None:
    obv_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100] * 24 + [110],
            "high": [101] * 24 + [111],
            "low": [99] * 24 + [109],
            "close": [100] * 24 + [112],
            "volume": [1000] * 24 + [8000],
        }
    )
    dmi_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100 - i for i in range(10)] + [91] * 10 + [95, 98, 102, 107, 113],
            "high": [101 - i for i in range(10)] + [92] * 10 + [97, 100, 105, 110, 117],
            "low": [99 - i for i in range(10)] + [90] * 10 + [94, 97, 100, 105, 110],
            "close": [100 - i for i in range(10)] + [91] * 10 + [96, 99, 104, 109, 116],
            "volume": [1000] * 25,
        }
    )
    chaikin_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100] * 24 + [108],
            "high": [101] * 24 + [110],
            "low": [99] * 24 + [100],
            "close": [100] * 24 + [109],
            "volume": [1000] * 24 + [7000],
        }
    )

    assert OBVTrendStrategy(fast=5, slow=12).generate_signal(obv_df) == 1
    assert DMIBreakoutStrategy(period=10, threshold=5).generate_signal(dmi_df) == 1
    assert ChaikinReversalStrategy(fast=3, slow=10).generate_signal(chaikin_df) == 1


def test_williams_cmf_aroon_and_roc_emit_buy_signals() -> None:
    williams_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=20, freq="D", tz="UTC"),
            "open": [100] * 19 + [82],
            "high": [101] * 19 + [84],
            "low": [99] * 19 + [80],
            "close": [100] * 19 + [81],
            "volume": [1000] * 20,
        }
    )
    cmf_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100 + i * 0.2 for i in range(25)],
            "high": [101 + i * 0.2 for i in range(25)],
            "low": [99 + i * 0.2 for i in range(25)],
            "close": [100.8 + i * 0.2 for i in range(25)],
            "volume": [1000] * 24 + [5000],
        }
    )
    aroon_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=25, freq="D", tz="UTC"),
            "open": [100 + i for i in range(25)],
            "high": [101 + i for i in range(25)],
            "low": [80] + [99 + i for i in range(24)],
            "close": [100.5 + i for i in range(25)],
            "volume": [1000] * 25,
        }
    )
    roc_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=20, freq="D", tz="UTC"),
            "open": [100] * 19 + [109],
            "high": [101] * 19 + [111],
            "low": [99] * 19 + [108],
            "close": [100] * 19 + [110],
            "volume": [1000] * 20,
        }
    )

    assert WilliamsReversalStrategy(period=14, oversold=-80, overbought=-20).generate_signal(williams_df) == 1
    assert ChaikinMoneyFlowTrendStrategy(period=20, threshold=0.05).generate_signal(cmf_df) == 1
    assert AroonTrendStrategy(period=25, threshold=70).generate_signal(aroon_df) == 1
    assert ROCBreakoutStrategy(period=12, threshold=5).generate_signal(roc_df) == 1


def test_wma_cmo_and_trix_emit_buy_signals() -> None:
    wma_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=30, freq="D", tz="UTC"),
            "open": [100] * 29 + [140],
            "high": [101] * 29 + [142],
            "low": [99] * 29 + [138],
            "close": [100] * 29 + [141],
            "volume": [1000] * 30,
        }
    )
    cmo_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=20, freq="D", tz="UTC"),
            "open": [100] * 20,
            "high": [101] * 20,
            "low": [80] * 20,
            "close": [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81],
            "volume": [1000] * 20,
        }
    )
    trix_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=70, freq="D", tz="UTC"),
            "open": [100 + i * 0.1 for i in range(69)] + [130],
            "high": [101 + i * 0.1 for i in range(69)] + [132],
            "low": [99 + i * 0.1 for i in range(69)] + [128],
            "close": [100 + i * 0.1 for i in range(69)] + [131],
            "volume": [1000] * 70,
        }
    )

    assert WMACrossStrategy(fast=5, slow=12).generate_signal(wma_df) == 1
    assert CMOReversalStrategy(period=14, oversold=-50, overbought=50).generate_signal(cmo_df) == 1
    assert TrixTrendStrategy(period=10, threshold=0.1).generate_signal(trix_df) == 1


def test_hma_stochrsi_fisher_and_coppock_emit_buy_signals() -> None:
    hma_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 39 + [145],
            "high": [101] * 39 + [147],
            "low": [99] * 39 + [143],
            "close": [100] * 39 + [146],
            "volume": [1000] * 40,
        }
    )
    oscillator_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=35, freq="D", tz="UTC"),
            "open": [100] * 35,
            "high": [101 - index * 0.5 for index in range(35)],
            "low": [99 - index for index in range(35)],
            "close": [100 - index for index in range(35)],
            "volume": [1000] * 35,
        }
    )
    coppock_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100 + i for i in range(40)],
            "high": [101 + i for i in range(40)],
            "low": [99 + i for i in range(40)],
            "close": [100.5 + i for i in range(40)],
            "volume": [1000] * 40,
        }
    )

    assert HMACrossStrategy(fast=9, slow=21).generate_signal(hma_df) == 1
    assert StochRSIReversalStrategy(period=14, oversold=20, overbought=80).generate_signal(oscillator_df) == 1
    assert FisherReversalStrategy(period=10, oversold=-1.5, overbought=1.5).generate_signal(oscillator_df) == 1
    assert CoppockTrendStrategy(period=14, threshold=0.5).generate_signal(coppock_df) == 1


def test_tema_uo_dpo_and_tsi_emit_buy_signals() -> None:
    tema_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 39 + [150],
            "high": [101] * 39 + [152],
            "low": [99] * 39 + [148],
            "close": [100] * 39 + [151],
            "volume": [1000] * 40,
        }
    )
    uo_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 39 + [85],
            "high": [101] * 39 + [86],
            "low": [99] * 39 + [70],
            "close": [100] * 39 + [72],
            "volume": [1000] * 40,
        }
    )
    dpo_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 39 + [82],
            "high": [101] * 39 + [84],
            "low": [99] * 39 + [80],
            "close": [100] * 39 + [81],
            "volume": [1000] * 40,
        }
    )
    tsi_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=60, freq="D", tz="UTC"),
            "open": [100 + i * 0.2 for i in range(60)],
            "high": [101 + i * 0.2 for i in range(60)],
            "low": [99 + i * 0.2 for i in range(60)],
            "close": [100.5 + i * 0.25 for i in range(60)],
            "volume": [1000] * 60,
        }
    )

    assert TEMACrossStrategy(fast=5, slow=20).generate_signal(tema_df) == 1
    assert UltimateOscillatorReversalStrategy(period=7, oversold=30, overbought=70).generate_signal(uo_df) == 1
    assert DPOReversalStrategy(period=20, oversold=-2, overbought=2).generate_signal(dpo_df) == 1
    assert TSITrendStrategy(period=13, threshold=10).generate_signal(tsi_df) == 1


def test_dema_zlema_schaff_and_vortex_emit_buy_signals() -> None:
    cross_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 39 + [152],
            "high": [101] * 39 + [154],
            "low": [99] * 39 + [150],
            "close": [100] * 39 + [153],
            "volume": [1000] * 40,
        }
    )
    oscillator_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=35, freq="D", tz="UTC"),
            "open": [100] * 35,
            "high": [101 - index * 0.5 for index in range(35)],
            "low": [99 - index for index in range(35)],
            "close": [100 - index for index in range(35)],
            "volume": [1000] * 35,
        }
    )
    trend_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=30, freq="D", tz="UTC"),
            "open": [100 + i for i in range(30)],
            "high": [101 + i for i in range(30)],
            "low": [99 + i for i in range(30)],
            "close": [100.5 + i for i in range(30)],
            "volume": [1000] * 30,
        }
    )

    assert DEMACrossStrategy(fast=5, slow=20).generate_signal(cross_df) == 1
    assert ZLEMACrossStrategy(fast=5, slow=20).generate_signal(cross_df) == 1
    assert SchaffReversalStrategy(period=14, oversold=25, overbought=75).generate_signal(oscillator_df) == 1
    assert VortexTrendStrategy(period=14, threshold=0.1).generate_signal(trend_df) == 1


def test_smma_vwma_awesome_and_kst_emit_buy_signals() -> None:
    cross_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 39 + [154],
            "high": [101] * 39 + [156],
            "low": [99] * 39 + [152],
            "close": [100] * 39 + [155],
            "volume": [1000] * 39 + [8000],
        }
    )
    oscillator_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=30, freq="D", tz="UTC"),
            "open": [100] * 29 + [85],
            "high": [101] * 29 + [86],
            "low": [99] * 29 + [70],
            "close": [100] * 29 + [72],
            "volume": [1000] * 30,
        }
    )
    trend_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=60, freq="D", tz="UTC"),
            "open": [100 + i * 0.3 for i in range(60)],
            "high": [101 + i * 0.3 for i in range(60)],
            "low": [99 + i * 0.3 for i in range(60)],
            "close": [100.5 + i * 0.35 for i in range(60)],
            "volume": [1000] * 60,
        }
    )

    assert SMMACrossStrategy(fast=5, slow=20).generate_signal(cross_df) == 1
    assert VWMACrossStrategy(fast=5, slow=20).generate_signal(cross_df) == 1
    assert AwesomeReversalStrategy(period=14, oversold=-1.0, overbought=1.0).generate_signal(oscillator_df) == 1
    assert KSTTrendStrategy(period=10, threshold=5).generate_signal(trend_df) == 1


def test_alma_trima_cfo_and_efi_emit_buy_signals() -> None:
    cross_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 38 + [95, 156],
            "high": [101] * 38 + [96, 158],
            "low": [99] * 38 + [94, 154],
            "close": [100] * 38 + [95, 157],
            "volume": [1000] * 40,
        }
    )
    oscillator_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=30, freq="D", tz="UTC"),
            "open": [100] * 29 + [82],
            "high": [101] * 29 + [84],
            "low": [99] * 29 + [80],
            "close": [100] * 29 + [81],
            "volume": [1000] * 30,
        }
    )
    trend_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100 + i * 0.4 for i in range(40)],
            "high": [101 + i * 0.4 for i in range(40)],
            "low": [99 + i * 0.4 for i in range(40)],
            "close": [100.5 + i * 0.45 for i in range(40)],
            "volume": [5000] * 40,
        }
    )

    assert ALMACrossStrategy(fast=9, slow=21).generate_signal(cross_df) == 1
    assert TRIMACrossStrategy(fast=5, slow=20).generate_signal(cross_df) == 1
    assert CFOReversalStrategy(period=14, oversold=-2, overbought=2).generate_signal(oscillator_df) == 1
    assert EFITrendStrategy(period=13, threshold=1000).generate_signal(trend_df) == 1


def test_lsma_demarker_rvi_and_vhf_emit_buy_signals() -> None:
    cross_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 38 + [95, 160],
            "high": [101] * 38 + [96, 162],
            "low": [99] * 38 + [94, 158],
            "close": [100] * 38 + [95, 161],
            "volume": [1000] * 40,
        }
    )
    oscillator_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=35, freq="D", tz="UTC"),
            "open": [100] * 35,
            "high": [101 - index * 0.5 for index in range(35)],
            "low": [99 - index for index in range(35)],
            "close": [100 - index for index in range(35)],
            "volume": [1000] * 35,
        }
    )
    trend_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=30, freq="D", tz="UTC"),
            "open": [100 + i for i in range(30)],
            "high": [101 + i for i in range(30)],
            "low": [99 + i for i in range(30)],
            "close": [100.5 + i for i in range(30)],
            "volume": [1000] * 30,
        }
    )

    assert LSMACrossStrategy(fast=9, slow=21).generate_signal(cross_df) == 1
    assert DeMarkerReversalStrategy(period=14, oversold=30, overbought=70).generate_signal(oscillator_df) == 1
    assert RVIReversalStrategy(period=10, oversold=-0.2, overbought=0.2).generate_signal(oscillator_df) == 1
    assert VHFTrendStrategy(period=14, threshold=0.4).generate_signal(trend_df) == 1


def test_mcginley_smi_vzo_and_pmo_emit_buy_signals() -> None:
    cross_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 38 + [96, 163],
            "high": [101] * 38 + [97, 165],
            "low": [99] * 38 + [95, 161],
            "close": [100] * 38 + [96, 164],
            "volume": [1000] * 40,
        }
    )
    oscillator_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=35, freq="D", tz="UTC"),
            "open": [100] * 35,
            "high": [101 - index * 0.5 for index in range(35)],
            "low": [99 - index for index in range(35)],
            "close": [100 - index for index in range(35)],
            "volume": [1000] * 35,
        }
    )
    trend_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=60, freq="D", tz="UTC"),
            "open": [100 + index * 0.3 for index in range(60)],
            "high": [101 + index * 0.3 for index in range(60)],
            "low": [99 + index * 0.3 for index in range(60)],
            "close": [100.5 + index * 0.35 for index in range(60)],
            "volume": [1000 + index * 20 for index in range(60)],
        }
    )

    assert McGinleyCrossStrategy(fast=8, slow=21).generate_signal(cross_df) == 1
    assert SMIReversalStrategy(period=14, oversold=-40, overbought=40).generate_signal(oscillator_df) == 1
    assert VZOTrendStrategy(period=14, threshold=15).generate_signal(trend_df) == 1
    assert PMOTrendStrategy(period=12, threshold=0.1).generate_signal(trend_df) == 1


def test_t3_bias_chaikin_vol_and_linreg_emit_buy_signals() -> None:
    cross_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100] * 38 + [95, 162],
            "high": [101] * 38 + [96, 164],
            "low": [99] * 38 + [94, 160],
            "close": [100] * 38 + [95, 163],
            "volume": [1000] * 40,
        }
    )
    oscillator_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=35, freq="D", tz="UTC"),
            "open": [100] * 35,
            "high": [101] * 35,
            "low": [80] * 35,
            "close": [100] * 34 + [90],
            "volume": [1000] * 35,
        }
    )
    trend_df = pd.DataFrame(
        {
            "time": pd.date_range("2024-01-01", periods=40, freq="D", tz="UTC"),
            "open": [100 + index * 0.3 for index in range(40)],
            "high": [101 + index * 0.3 for index in range(39)] + [130],
            "low": [99 + index * 0.3 for index in range(39)] + [100],
            "close": [100.5 + index * 0.35 for index in range(39)] + [128],
            "volume": [1000] * 40,
        }
    )

    assert T3CrossStrategy(fast=5, slow=20).generate_signal(cross_df) == 1
    assert BIASReversalStrategy(period=14, oversold=-5, overbought=5).generate_signal(oscillator_df) == 1
    assert ChaikinVolatilityTrendStrategy(period=10, threshold=10).generate_signal(trend_df) == 1
    assert LinRegSlopeTrendStrategy(period=14, threshold=0.3).generate_signal(trend_df) == 1
