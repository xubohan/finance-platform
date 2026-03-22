"""Relative vigor index reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class RVIReversalStrategy(BaseStrategy):
    """Buy in negative RVI extremes, sell in positive extremes."""

    def __init__(self, period: int = 10, oversold: float = -0.2, overbought: float = 0.2):
        if period < 4:
            raise ValueError("period must be at least 4")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period:
            return 0

        close = df["close"].astype(float)
        open_ = df["open"].astype(float)
        high = df["high"].astype(float)
        low = df["low"].astype(float)

        numerator = (close - open_).rolling(self.period).mean()
        denominator = (high - low).replace(0, float("nan")).rolling(self.period).mean()
        rvi = numerator / denominator

        last_value = rvi.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
