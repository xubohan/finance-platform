"""Vertical horizontal filter trend strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class VHFTrendStrategy(BaseStrategy):
    """Buy when VHF confirms an uptrend, sell when it confirms a downtrend."""

    def __init__(self, period: int = 14, threshold: float = 0.4):
        if period < 5:
            raise ValueError("period must be at least 5")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period:
            return 0

        close = df["close"].astype(float)
        highest = close.rolling(self.period).max()
        lowest = close.rolling(self.period).min()
        net_move = highest - lowest
        total_move = close.diff().abs().rolling(self.period).sum().replace(0, float("nan"))
        vhf = net_move / total_move

        last_vhf = vhf.iloc[-1]
        if pd.isna(last_vhf) or float(last_vhf) < self.threshold:
            return 0

        trend_reference = close.iloc[-self.period]
        current_close = close.iloc[-1]
        if current_close > trend_reference:
            return 1
        if current_close < trend_reference:
            return -1
        return 0
