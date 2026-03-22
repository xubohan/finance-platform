"""BIAS mean-reversion strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class BIASReversalStrategy(BaseStrategy):
    """Buy when price is far below its moving average, sell when far above it."""

    def __init__(self, period: int = 14, oversold: float = -5.0, overbought: float = 5.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period:
            return 0

        close = df["close"].astype(float)
        moving_average = close.rolling(self.period).mean().replace(0, float("nan"))
        bias = ((close - moving_average) / moving_average) * 100

        last_value = bias.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
