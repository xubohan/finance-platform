"""Fisher transform reversal strategy."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backtest.strategies.base import BaseStrategy


class FisherReversalStrategy(BaseStrategy):
    """Buy in negative Fisher extremes and sell in positive Fisher extremes."""

    def __init__(self, period: int = 10, oversold: float = -1.5, overbought: float = 1.5):
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
        rolling_low = close.rolling(self.period).min()
        rolling_high = close.rolling(self.period).max()
        spread = (rolling_high - rolling_low).replace(0, float("nan"))
        normalized = ((close - rolling_low) / spread).clip(0.001, 0.999)
        x_value = normalized * 2 - 1
        fisher = 0.5 * np.log((1 + x_value) / (1 - x_value))

        last_value = fisher.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
