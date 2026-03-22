"""Chaikin volatility trend strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class ChaikinVolatilityTrendStrategy(BaseStrategy):
    """Buy when volatility expansion confirms an uptrend, sell on strong downside expansion."""

    def __init__(self, period: int = 10, threshold: float = 10.0):
        if period < 4:
            raise ValueError("period must be at least 4")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period * 2:
            return 0

        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)

        ema_range = (high - low).ewm(span=self.period, adjust=False).mean()
        volatility = ema_range.pct_change(self.period) * 100
        last_volatility = volatility.iloc[-1]
        if pd.isna(last_volatility):
            return 0

        if float(last_volatility) >= self.threshold and close.iloc[-1] > close.iloc[-self.period]:
            return 1
        if float(last_volatility) <= -self.threshold and close.iloc[-1] < close.iloc[-self.period]:
            return -1
        return 0
