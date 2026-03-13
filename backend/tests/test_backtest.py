"""Backtest engine high-value tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from backtest.engine import BacktestEngine
from backtest.strategies.ma_cross import MACrossStrategy


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
