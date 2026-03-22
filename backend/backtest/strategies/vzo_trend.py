"""Volume Zone Oscillator trend strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class VZOTrendStrategy(BaseStrategy):
    """Buy on positive volume-zone momentum, sell on negative momentum."""

    def __init__(self, period: int = 14, threshold: float = 15.0):
        if period < 4:
            raise ValueError("period must be at least 4")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period:
            return 0

        close = df["close"].astype(float)
        volume = df["volume"].astype(float)
        direction = close.diff().fillna(0.0).apply(lambda value: 1.0 if value > 0 else (-1.0 if value < 0 else 0.0))
        signed_volume = volume * direction
        vzo = 100 * signed_volume.ewm(span=self.period, adjust=False).mean() / volume.ewm(span=self.period, adjust=False).mean().replace(0, float("nan"))

        last_value = vzo.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) >= self.threshold:
            return 1
        if float(last_value) <= -self.threshold:
            return -1
        return 0
