"""TRIX trend-follow strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class TrixTrendStrategy(BaseStrategy):
    """Buy on positive triple-smoothed momentum and sell on negative momentum."""

    def __init__(self, period: int = 15, threshold: float = 0.2):
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
        ema1 = close.ewm(span=self.period, adjust=False).mean()
        ema2 = ema1.ewm(span=self.period, adjust=False).mean()
        ema3 = ema2.ewm(span=self.period, adjust=False).mean()
        trix = ema3.pct_change() * 100

        last_trix = trix.iloc[-1]
        if pd.isna(last_trix):
            return 0
        if float(last_trix) >= self.threshold:
            return 1
        if float(last_trix) <= -self.threshold:
            return -1
        return 0
