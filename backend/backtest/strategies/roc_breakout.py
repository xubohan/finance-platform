"""Rate-of-change breakout strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class ROCBreakoutStrategy(BaseStrategy):
    """Buy on positive momentum breakout, sell on negative breakdown."""

    def __init__(self, period: int = 12, threshold: float = 5.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period:
            return 0

        close = df["close"].astype(float)
        base_close = close.shift(self.period)
        roc = (close / base_close.replace(0, float("nan")) - 1) * 100
        last_roc = roc.iloc[-1]
        if pd.isna(last_roc):
            return 0
        if float(last_roc) >= self.threshold:
            return 1
        if float(last_roc) <= -self.threshold:
            return -1
        return 0
