"""Vortex indicator trend strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class VortexTrendStrategy(BaseStrategy):
    """Buy when +VI leads -VI by threshold, sell on inverse dominance."""

    def __init__(self, period: int = 14, threshold: float = 0.1):
        if period < 5:
            raise ValueError("period must be at least 5")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period:
            return 0

        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)
        prev_high = high.shift(1)
        prev_low = low.shift(1)
        prev_close = close.shift(1)

        vm_plus = (high - prev_low).abs()
        vm_minus = (low - prev_high).abs()
        tr = pd.concat([high, prev_close], axis=1).max(axis=1) - pd.concat([low, prev_close], axis=1).min(axis=1)
        tr = tr.replace(0, float("nan"))

        vi_plus = vm_plus.rolling(self.period).sum() / tr.rolling(self.period).sum()
        vi_minus = vm_minus.rolling(self.period).sum() / tr.rolling(self.period).sum()
        gap = vi_plus - vi_minus

        last_gap = gap.iloc[-1]
        if pd.isna(last_gap):
            return 0
        if float(last_gap) >= self.threshold:
            return 1
        if float(last_gap) <= -self.threshold:
            return -1
        return 0
