"""Detrended price oscillator reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class DPOReversalStrategy(BaseStrategy):
    """Buy when detrended price is deeply negative, sell when deeply positive."""

    def __init__(self, period: int = 20, oversold: float = -2.0, overbought: float = 2.0):
        if period < 6:
            raise ValueError("period must be at least 6")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        offset = self.period // 2 + 1
        if len(df) < self.period + offset:
            return 0

        close = df["close"].astype(float)
        sma = close.rolling(self.period).mean()
        reference = sma.shift(offset)
        dpo_pct = ((close - reference) / reference.replace(0, float("nan"))) * 100

        last_value = dpo_pct.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
