"""True strength index trend strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class TSITrendStrategy(BaseStrategy):
    """Buy on positive true-strength momentum, sell on negative momentum."""

    def __init__(self, period: int = 13, threshold: float = 10.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period * 3:
            return 0

        close = df["close"].astype(float)
        momentum = close.diff()
        ema1 = momentum.ewm(span=self.period, adjust=False).mean()
        ema2 = ema1.ewm(span=self.period, adjust=False).mean()
        abs_ema1 = momentum.abs().ewm(span=self.period, adjust=False).mean()
        abs_ema2 = abs_ema1.ewm(span=self.period, adjust=False).mean()
        tsi = 100 * (ema2 / abs_ema2.replace(0, float("nan")))

        last_value = tsi.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) >= self.threshold:
            return 1
        if float(last_value) <= -self.threshold:
            return -1
        return 0
