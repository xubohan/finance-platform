"""Volume-weighted moving-average crossover strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class VWMACrossStrategy(BaseStrategy):
    """Buy when fast VWMA crosses above slow VWMA, sell on reverse cross."""

    def __init__(self, fast: int = 5, slow: int = 20):
        if fast < 2:
            raise ValueError("fast must be at least 2")
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        self.fast = fast
        self.slow = slow

    @staticmethod
    def _vwma(close: pd.Series, volume: pd.Series, window: int) -> pd.Series:
        rolling_volume = volume.rolling(window).sum().replace(0, float("nan"))
        return (close * volume).rolling(window).sum() / rolling_volume

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 2:
            return 0

        close = df["close"].astype(float)
        volume = df["volume"].astype(float)
        fast_line = self._vwma(close, volume, self.fast)
        slow_line = self._vwma(close, volume, self.slow)

        prev_fast = fast_line.iloc[-2]
        prev_slow = slow_line.iloc[-2]
        curr_fast = fast_line.iloc[-1]
        curr_slow = slow_line.iloc[-1]
        if pd.isna(prev_fast) or pd.isna(prev_slow) or pd.isna(curr_fast) or pd.isna(curr_slow):
            return 0
        if prev_fast <= prev_slow and curr_fast > curr_slow:
            return 1
        if prev_fast >= prev_slow and curr_fast < curr_slow:
            return -1
        return 0
