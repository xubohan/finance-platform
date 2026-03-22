"""ATR breakout strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class ATRBreakoutStrategy(BaseStrategy):
    """Buy on ATR-based upside breakout and sell on ATR-based downside break."""

    def __init__(self, period: int = 14, multiplier: float = 2.0):
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
        rolling_high = high.shift(1).rolling(self.period).max()
        rolling_low = low.shift(1).rolling(self.period).min()

        last_close = float(close.iloc[-1])
        last_atr = atr.iloc[-1]
        last_high = rolling_high.iloc[-1]
        last_low = rolling_low.iloc[-1]
        if pd.isna(last_atr) or pd.isna(last_high) or pd.isna(last_low):
            return 0

        if last_close >= float(last_high) + self.multiplier * float(last_atr):
            return 1
        if last_close <= float(last_low) - self.multiplier * float(last_atr):
            return -1
        return 0
