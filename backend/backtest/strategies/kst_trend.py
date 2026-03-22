"""Know Sure Thing trend strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class KSTTrendStrategy(BaseStrategy):
    """Buy on strong positive KST momentum, sell on negative momentum."""

    def __init__(self, period: int = 10, threshold: float = 5.0):
        if period < 4:
            raise ValueError("period must be at least 4")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        p1 = self.period
        p2 = self.period * 2
        p3 = self.period * 3
        p4 = self.period * 4
        if len(df) <= p4 + p1:
            return 0

        close = df["close"].astype(float)
        roc1 = close.pct_change(p1) * 100
        roc2 = close.pct_change(p2) * 100
        roc3 = close.pct_change(p3) * 100
        roc4 = close.pct_change(p4) * 100

        kst = (
            roc1.rolling(p1).mean()
            + 2 * roc2.rolling(p1).mean()
            + 3 * roc3.rolling(p1).mean()
            + 4 * roc4.rolling(p1).mean()
        )

        last_value = kst.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) >= self.threshold:
            return 1
        if float(last_value) <= -self.threshold:
            return -1
        return 0
