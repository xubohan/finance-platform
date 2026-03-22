"""Hull moving-average crossover strategy."""

from __future__ import annotations

import math
import numpy as np
import pandas as pd

from backtest.strategies.base import BaseStrategy


class HMACrossStrategy(BaseStrategy):
    """Buy when fast HMA crosses above slow HMA, sell on reverse cross."""

    def __init__(self, fast: int = 9, slow: int = 21):
        if fast < 2:
            raise ValueError("fast must be at least 2")
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        self.fast = fast
        self.slow = slow

    @staticmethod
    def _weighted_ma(series: pd.Series, window: int) -> pd.Series:
        weights = np.arange(1, window + 1, dtype=float)
        weight_sum = float(weights.sum())
        return series.rolling(window).apply(lambda values: float(np.dot(values, weights) / weight_sum), raw=True)

    @classmethod
    def _hma(cls, series: pd.Series, window: int) -> pd.Series:
        half = max(2, window // 2)
        root = max(2, int(math.sqrt(window)))
        raw = 2 * cls._weighted_ma(series, half) - cls._weighted_ma(series, window)
        return cls._weighted_ma(raw, root)

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 2:
            return 0

        close = df["close"].astype(float)
        fast_line = self._hma(close, self.fast)
        slow_line = self._hma(close, self.slow)

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
