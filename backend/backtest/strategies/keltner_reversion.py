"""Keltner-channel mean reversion strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class KeltnerReversionStrategy(BaseStrategy):
    """Buy below the lower Keltner band and exit near the EMA centerline."""

    def __init__(self, period: int = 20, multiplier: float = 1.5):
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
        typical = (high + low + close) / 3
        ema = typical.ewm(span=self.period, adjust=False).mean()

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
        lower_band = ema - self.multiplier * atr

        last_close = float(close.iloc[-1])
        last_ema = ema.iloc[-1]
        last_lower = lower_band.iloc[-1]
        if pd.isna(last_ema) or pd.isna(last_lower):
            return 0
        if last_close <= last_lower:
            return 1
        if last_close >= last_ema:
            return -1
        return 0
