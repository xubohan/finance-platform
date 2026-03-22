"""Price Momentum Oscillator trend strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class PMOTrendStrategy(BaseStrategy):
    """Buy on positive PMO momentum, sell on negative momentum."""

    def __init__(self, period: int = 12, threshold: float = 0.5):
        if period < 4:
            raise ValueError("period must be at least 4")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period * 3:
            return 0

        close = df["close"].astype(float)
        roc = close.pct_change() * 100
        smoothed = roc.ewm(span=self.period, adjust=False).mean()
        pmo = smoothed.ewm(span=self.period, adjust=False).mean()

        last_value = pmo.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) >= self.threshold:
            return 1
        if float(last_value) <= -self.threshold:
            return -1
        return 0
