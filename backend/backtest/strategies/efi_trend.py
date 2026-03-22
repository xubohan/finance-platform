"""Elder Force Index trend strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class EFITrendStrategy(BaseStrategy):
    """Buy on positive Elder Force Index momentum, sell on negative momentum."""

    def __init__(self, period: int = 13, threshold: float = 1000.0):
        if period < 3:
            raise ValueError("period must be at least 3")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period:
            return 0

        close = df["close"].astype(float)
        volume = df["volume"].astype(float)
        force_index = close.diff() * volume
        efi = force_index.ewm(span=self.period, adjust=False).mean()

        last_value = efi.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) >= self.threshold:
            return 1
        if float(last_value) <= -self.threshold:
            return -1
        return 0
