"""Chaikin oscillator reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class ChaikinReversalStrategy(BaseStrategy):
    """Buy on Chaikin oscillator bullish zero-cross, sell on bearish zero-cross."""

    def __init__(self, fast: int = 3, slow: int = 10):
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        self.fast = fast
        self.slow = slow

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 2:
            return 0

        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)
        volume = df["volume"].astype(float)

        spread = (high - low).replace(0, float("nan"))
        multiplier = ((close - low) - (high - close)) / spread
        multiplier = multiplier.fillna(0.0)
        adl = (multiplier * volume).cumsum()
        osc = adl.ewm(span=self.fast, adjust=False).mean() - adl.ewm(span=self.slow, adjust=False).mean()

        prev_osc = osc.iloc[-2]
        curr_osc = osc.iloc[-1]
        if pd.isna(prev_osc) or pd.isna(curr_osc):
            return 0
        if prev_osc <= 0 and curr_osc > 0:
            return 1
        if prev_osc >= 0 and curr_osc < 0:
            return -1
        return 0
