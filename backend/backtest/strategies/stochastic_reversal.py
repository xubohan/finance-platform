"""Stochastic oscillator reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class StochasticReversalStrategy(BaseStrategy):
    """Buy when %K falls into oversold, sell when it rises into overbought."""

    def __init__(self, period: int = 14, oversold: float = 20.0, overbought: float = 80.0):
        if period < 5:
            raise ValueError("period must be at least 5")
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

        k_value = (close - lowest) / (highest - lowest) * 100
        if k_value <= self.oversold:
            return 1
        if k_value >= self.overbought:
            return -1
        return 0
