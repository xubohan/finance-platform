"""DeMarker reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class DeMarkerReversalStrategy(BaseStrategy):
    """Buy when DeMarker falls into oversold, sell in overbought territory."""

    def __init__(self, period: int = 14, oversold: float = 30.0, overbought: float = 70.0):
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
        demax = high.diff().where(high.diff() > 0, 0.0)
        demin = (low.shift(1) - low).where((low.shift(1) - low) > 0, 0.0)
        avg_max = demax.rolling(self.period).mean()
        avg_min = demin.rolling(self.period).mean()
        demarker = 100 * (avg_max / (avg_max + avg_min).replace(0, float("nan")))

        last_value = demarker.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
