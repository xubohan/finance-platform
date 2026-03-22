"""Linear-regression slope trend strategy."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backtest.strategies.base import BaseStrategy


class LinRegSlopeTrendStrategy(BaseStrategy):
    """Buy when the linear-regression slope is strongly positive, sell when strongly negative."""

    def __init__(self, period: int = 14, threshold: float = 0.3):
        if period < 5:
            raise ValueError("period must be at least 5")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period:
            return 0

        close = df["close"].astype(float).iloc[-self.period :]
        x_axis = np.arange(self.period, dtype=float)
        slope, _ = np.polyfit(x_axis, close.to_numpy(), 1)
        baseline = float(close.mean())
        if baseline == 0:
            return 0
        normalized_slope = slope / baseline * 100

        if normalized_slope >= self.threshold:
            return 1
        if normalized_slope <= -self.threshold:
            return -1
        return 0
