"""Ultimate oscillator reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class UltimateOscillatorReversalStrategy(BaseStrategy):
    """Buy in oversold multi-window momentum, sell in overbought momentum."""

    def __init__(self, period: int = 7, oversold: float = 30.0, overbought: float = 70.0):
        if period < 4:
            raise ValueError("period must be at least 4")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        medium_period = self.period * 2
        long_period = self.period * 4
        if len(df) <= long_period:
            return 0

        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)
        prev_close = close.shift(1)

        buying_pressure = close - pd.concat([low, prev_close], axis=1).min(axis=1)
        true_range = pd.concat([high, prev_close], axis=1).max(axis=1) - pd.concat([low, prev_close], axis=1).min(axis=1)
        true_range = true_range.replace(0, float("nan"))

        avg_short = buying_pressure.rolling(self.period).sum() / true_range.rolling(self.period).sum()
        avg_medium = buying_pressure.rolling(medium_period).sum() / true_range.rolling(medium_period).sum()
        avg_long = buying_pressure.rolling(long_period).sum() / true_range.rolling(long_period).sum()
        uo = 100 * ((4 * avg_short) + (2 * avg_medium) + avg_long) / 7

        last_value = uo.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
