"""Least-squares moving-average crossover strategy."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backtest.strategies.base import BaseStrategy


class LSMACrossStrategy(BaseStrategy):
    """Buy when fast LSMA crosses above slow LSMA, sell on reverse cross."""

    def __init__(self, fast: int = 9, slow: int = 21):
        if fast < 2:
            raise ValueError("fast must be at least 2")
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        self.fast = fast
        self.slow = slow

    @staticmethod
    def _lsma(series: pd.Series, window: int) -> pd.Series:
        x_axis = np.arange(window, dtype=float)

        def endpoint(values: np.ndarray) -> float:
            slope, intercept = np.polyfit(x_axis, values, 1)
            return float(slope * (window - 1) + intercept)

        return series.rolling(window).apply(endpoint, raw=True)

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 2:
            return 0

        close = df["close"].astype(float)
        fast_line = self._lsma(close, self.fast)
        slow_line = self._lsma(close, self.slow)

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
