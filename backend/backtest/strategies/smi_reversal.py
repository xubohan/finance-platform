"""Stochastic Momentum Index reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class SMIReversalStrategy(BaseStrategy):
    """Buy in deep negative SMI territory, sell in positive extremes."""

    def __init__(self, period: int = 14, oversold: float = -40.0, overbought: float = 40.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period:
            return 0

        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)

        highest = high.rolling(self.period).max()
        lowest = low.rolling(self.period).min()
        midpoint = (highest + lowest) / 2
        distance = close - midpoint
        spread = highest - lowest

        smooth_distance = distance.ewm(span=max(3, self.period // 2), adjust=False).mean().ewm(
            span=max(3, self.period // 2),
            adjust=False,
        ).mean()
        smooth_spread = spread.ewm(span=max(3, self.period // 2), adjust=False).mean().ewm(
            span=max(3, self.period // 2),
            adjust=False,
        ).mean()
        smi = 100 * smooth_distance / (smooth_spread / 2).replace(0, float("nan"))

        last_value = smi.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
