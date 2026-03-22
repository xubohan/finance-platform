"""On-Balance Volume trend-follow strategy."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backtest.strategies.base import BaseStrategy


class OBVTrendStrategy(BaseStrategy):
    """Buy on fast/slow OBV EMA bullish crossover, sell on bearish crossover."""

    def __init__(self, fast: int = 8, slow: int = 21):
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        self.fast = fast
        self.slow = slow

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 1:
            return 0

        close = df["close"].astype(float)
        volume = df["volume"].astype(float)
        direction = np.sign(close.diff().fillna(0.0))
        obv = (direction * volume).cumsum()

        fast_ema = obv.ewm(span=self.fast, adjust=False).mean()
        slow_ema = obv.ewm(span=self.slow, adjust=False).mean()

        prev_fast, prev_slow = fast_ema.iloc[-2], slow_ema.iloc[-2]
        curr_fast, curr_slow = fast_ema.iloc[-1], slow_ema.iloc[-1]

        if prev_fast <= prev_slow and curr_fast > curr_slow:
            return 1
        if prev_fast >= prev_slow and curr_fast < curr_slow:
            return -1
        return 0
