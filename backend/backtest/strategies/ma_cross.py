"""Moving-average crossover strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class MACrossStrategy(BaseStrategy):
    """Buy on fast MA crossing above slow MA, sell on reverse cross."""

    def __init__(self, fast: int = 5, slow: int = 20):
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        self.fast = fast
        self.slow = slow

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 1:
            return 0

        fast_ma = df["close"].rolling(self.fast).mean()
        slow_ma = df["close"].rolling(self.slow).mean()

        prev_fast, prev_slow = fast_ma.iloc[-2], slow_ma.iloc[-2]
        curr_fast, curr_slow = fast_ma.iloc[-1], slow_ma.iloc[-1]

        if prev_fast <= prev_slow and curr_fast > curr_slow:
            return 1
        if prev_fast >= prev_slow and curr_fast < curr_slow:
            return -1
        return 0
