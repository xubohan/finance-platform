"""Aroon trend-follow strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class AroonTrendStrategy(BaseStrategy):
    """Buy when Aroon Up dominates above threshold, sell on Aroon Down dominance."""

    def __init__(self, period: int = 25, threshold: float = 70.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if threshold <= 0 or threshold > 100:
            raise ValueError("threshold must be within (0, 100]")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period:
            return 0

        window = df.iloc[-self.period :]
        highs = window["high"].astype(float).to_numpy()
        lows = window["low"].astype(float).to_numpy()
        span = max(len(window) - 1, 1)

        aroon_up = float(highs.argmax()) / span * 100
        aroon_down = float(lows.argmin()) / span * 100

        if aroon_up >= self.threshold and aroon_up > aroon_down:
            return 1
        if aroon_down >= self.threshold and aroon_down > aroon_up:
            return -1
        return 0
