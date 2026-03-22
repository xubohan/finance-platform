"""Chande Forecast Oscillator reversal strategy."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backtest.strategies.base import BaseStrategy


class CFOReversalStrategy(BaseStrategy):
    """Buy when CFO is deeply negative, sell when strongly positive."""

    def __init__(self, period: int = 14, oversold: float = -2.0, overbought: float = 2.0):
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
        window = close.iloc[-self.period :]
        x_axis = np.arange(self.period, dtype=float)
        slope, intercept = np.polyfit(x_axis, window.to_numpy(), 1)
        forecast = slope * (self.period - 1) + intercept
        if forecast == 0:
            return 0
        cfo = ((float(window.iloc[-1]) - forecast) / forecast) * 100

        if cfo <= self.oversold:
            return 1
        if cfo >= self.overbought:
            return -1
        return 0
