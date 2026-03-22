"""Coppock curve trend strategy."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backtest.strategies.base import BaseStrategy


class CoppockTrendStrategy(BaseStrategy):
    """Buy on positive Coppock momentum and sell on negative momentum."""

    def __init__(self, period: int = 14, threshold: float = 0.5):
        if period < 5:
            raise ValueError("period must be at least 5")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    @staticmethod
    def _weighted_ma(series: pd.Series, window: int) -> pd.Series:
        weights = np.arange(1, window + 1, dtype=float)
        weight_sum = float(weights.sum())
        return series.rolling(window).apply(lambda values: float(np.dot(values, weights) / weight_sum), raw=True)

    def generate_signal(self, df: pd.DataFrame) -> int:
        short_roc_period = max(5, int(self.period * 0.8))
        if len(df) <= self.period + short_roc_period:
            return 0

        close = df["close"].astype(float)
        roc_long = close.pct_change(self.period) * 100
        roc_short = close.pct_change(short_roc_period) * 100
        coppock = self._weighted_ma(roc_long + roc_short, self.period)

        last_value = coppock.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) >= self.threshold:
            return 1
        if float(last_value) <= -self.threshold:
            return -1
        return 0
