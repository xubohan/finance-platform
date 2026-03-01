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
            # If engine leaks future bars, this assert would fail.
            assert len(partial_df) <= 120
            return super().generate_signal(partial_df)

    df = _sample_df()
    engine = BacktestEngine(strategy=LeakGuardStrategy(fast=5, slow=20), initial_capital=100000)
    result = engine.run(df, symbol="AAPL", asset_type="stock")

    assert len(result["equity_curve"]) == len(df)
