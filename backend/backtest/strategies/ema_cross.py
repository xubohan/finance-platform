"""Exponential moving-average crossover strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class EMACrossStrategy(BaseStrategy):
    """Buy on fast EMA crossing above slow EMA, sell on reverse cross."""

    def __init__(self, fast: int = 8, slow: int = 21):
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        self.fast = fast
        self.slow = slow

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 1:
            return 0

        fast_ema = df["close"].ewm(span=self.fast, adjust=False).mean()
        slow_ema = df["close"].ewm(span=self.slow, adjust=False).mean()

        prev_fast, prev_slow = fast_ema.iloc[-2], slow_ema.iloc[-2]
        curr_fast, curr_slow = fast_ema.iloc[-1], slow_ema.iloc[-1]

        if prev_fast <= prev_slow and curr_fast > curr_slow:
            return 1
        if prev_fast >= prev_slow and curr_fast < curr_slow:
            return -1
        return 0
