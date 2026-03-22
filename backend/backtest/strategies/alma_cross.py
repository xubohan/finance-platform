"""Arnaud Legoux moving-average crossover strategy."""

from __future__ import annotations

import math

import pandas as pd

from backtest.strategies.base import BaseStrategy


class ALMACrossStrategy(BaseStrategy):
    """Buy when fast ALMA crosses above slow ALMA, sell on reverse cross."""

    def __init__(self, fast: int = 9, slow: int = 21, offset: float = 0.85, sigma: float = 6.0):
        if fast < 2:
            raise ValueError("fast must be at least 2")
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        if not 0 <= offset <= 1:
            raise ValueError("offset must be within [0, 1]")
        if sigma <= 0:
            raise ValueError("sigma must be positive")
        self.fast = fast
        self.slow = slow
        self.offset = offset
        self.sigma = sigma

    def _alma(self, series: pd.Series, window: int) -> pd.Series:
        m = self.offset * (window - 1)
        s = window / self.sigma
        weights = [math.exp(-((idx - m) ** 2) / (2 * s * s)) for idx in range(window)]
        weight_sum = sum(weights)
        normalized = [weight / weight_sum for weight in weights]
        return series.rolling(window).apply(lambda values: float(sum(v * w for v, w in zip(values, normalized))), raw=True)

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 2:
            return 0

        close = df["close"].astype(float)
        fast_line = self._alma(close, self.fast)
        slow_line = self._alma(close, self.slow)

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
