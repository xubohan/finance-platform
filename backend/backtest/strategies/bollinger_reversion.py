"""Bollinger-band mean reversion strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class BollingerReversionStrategy(BaseStrategy):
    """Buy below the lower band and exit back near the middle band."""

    def __init__(self, period: int = 20, stddev: float = 2.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if stddev <= 0:
            raise ValueError("stddev must be positive")
        self.period = period
        self.stddev = stddev

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period:
            return 0

        close = df["close"].astype(float)
        middle = close.rolling(self.period).mean()
        band_std = close.rolling(self.period).std(ddof=0)

        last_close = float(close.iloc[-1])
        last_middle = float(middle.iloc[-1])
        last_std = float(band_std.iloc[-1])
        if pd.isna(last_middle) or pd.isna(last_std):
            return 0

        lower = last_middle - self.stddev * last_std
        upper = last_middle + self.stddev * last_std

        if last_close <= lower:
            return 1
        if last_close >= last_middle or last_close >= upper:
            return -1
        return 0
