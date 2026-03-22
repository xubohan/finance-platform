"""Supertrend-follow strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class SupertrendFollowStrategy(BaseStrategy):
    """Buy on upside supertrend break and sell on downside break."""

    def __init__(self, period: int = 10, multiplier: float = 3.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if multiplier <= 0:
            raise ValueError("multiplier must be positive")
        self.period = period
        self.multiplier = multiplier

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period + 1:
            return 0

        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)

        prev_close = close.shift(1)
        true_range = pd.concat(
            [
                high - low,
                (high - prev_close).abs(),
                (low - prev_close).abs(),
            ],
            axis=1,
        ).max(axis=1)
        atr = true_range.rolling(self.period).mean()
        hl2 = (high + low) / 2
        upper_band = hl2 + self.multiplier * atr
        lower_band = hl2 - self.multiplier * atr

        prev_close_value = float(close.iloc[-2])
        curr_close_value = float(close.iloc[-1])
        prev_upper = upper_band.iloc[-2]
        prev_lower = lower_band.iloc[-2]
        curr_upper = upper_band.iloc[-1]
        curr_lower = lower_band.iloc[-1]

        if pd.isna(prev_upper) or pd.isna(prev_lower) or pd.isna(curr_upper) or pd.isna(curr_lower):
            return 0
        if prev_close_value <= prev_upper and curr_close_value > curr_upper:
            return 1
        if prev_close_value >= prev_lower and curr_close_value < curr_lower:
            return -1
        return 0
