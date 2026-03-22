"""Schaff trend-cycle reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class SchaffReversalStrategy(BaseStrategy):
    """Buy when Schaff cycle falls into oversold, sell in overbought territory."""

    def __init__(self, period: int = 14, oversold: float = 25.0, overbought: float = 75.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period * 2:
            return 0

        close = df["close"].astype(float)
        fast = max(3, self.period // 2)
        slow = max(fast + 2, int(self.period * 1.5))

        macd = close.ewm(span=fast, adjust=False).mean() - close.ewm(span=slow, adjust=False).mean()
        lowest = macd.rolling(self.period).min()
        highest = macd.rolling(self.period).max()
        spread = highest - lowest
        stoch = ((macd - lowest) / spread.replace(0, float("nan"))) * 100
        stoch = stoch.where(spread != 0, 0.0)
        cycle = stoch.ewm(span=max(3, self.period // 3), adjust=False).mean()

        last_value = cycle.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
