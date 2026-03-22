"""Williams %R reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class WilliamsReversalStrategy(BaseStrategy):
    """Buy in deep oversold Williams %R territory and sell in overbought territory."""

    def __init__(self, period: int = 14, oversold: float = -80.0, overbought: float = -20.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if oversold < -100 or overbought > 0:
            raise ValueError("williams thresholds must stay within [-100, 0]")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period:
            return 0

        window = df.iloc[-self.period :]
        highest = float(window["high"].max())
        lowest = float(window["low"].min())
        close = float(window["close"].iloc[-1])
        if highest == lowest:
            return 0

        williams_r = (highest - close) / (highest - lowest) * -100
        if williams_r <= self.oversold:
            return 1
        if williams_r >= self.overbought:
            return -1
        return 0
