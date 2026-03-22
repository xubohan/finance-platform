"""ADX trend-follow strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class ADXTrendStrategy(BaseStrategy):
    """Buy when +DI dominates above ADX threshold, sell when -DI dominates."""

    def __init__(self, period: int = 14, threshold: float = 25.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period + 2:
            return 0

        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)

        up_move = high.diff()
        down_move = -low.diff()
        plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
        minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)

        prev_close = close.shift(1)
        tr = pd.concat(
            [
                high - low,
                (high - prev_close).abs(),
                (low - prev_close).abs(),
            ],
            axis=1,
        ).max(axis=1)

        atr = tr.rolling(self.period).mean()
        plus_di = 100 * (plus_dm.rolling(self.period).mean() / atr.replace(0, float("nan")))
        minus_di = 100 * (minus_dm.rolling(self.period).mean() / atr.replace(0, float("nan")))
        dx = 100 * ((plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, float("nan")))
        adx = dx.rolling(self.period).mean()

        curr_adx = adx.iloc[-1]
        curr_plus = plus_di.iloc[-1]
        curr_minus = minus_di.iloc[-1]
        if pd.isna(curr_adx) or pd.isna(curr_plus) or pd.isna(curr_minus):
            return 0
        if curr_adx >= self.threshold and curr_plus > curr_minus:
            return 1
        if curr_adx >= self.threshold and curr_minus > curr_plus:
            return -1
        return 0
