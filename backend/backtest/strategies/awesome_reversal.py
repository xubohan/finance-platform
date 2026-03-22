"""Awesome oscillator reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class AwesomeReversalStrategy(BaseStrategy):
    """Buy in deeply negative awesome-oscillator territory, sell in positive extremes."""

    def __init__(self, period: int = 14, oversold: float = -1.0, overbought: float = 1.0):
        if period < 6:
            raise ValueError("period must be at least 6")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        fast = max(3, self.period // 2)
        slow = max(fast + 2, self.period)
        if len(df) < slow:
            return 0

        median_price = (df["high"].astype(float) + df["low"].astype(float)) / 2
        awesome = median_price.rolling(fast).mean() - median_price.rolling(slow).mean()

        last_value = awesome.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
