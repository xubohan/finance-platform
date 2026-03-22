"""Donchian-channel breakout strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class DonchianBreakoutStrategy(BaseStrategy):
    """Buy on upside channel breakout and exit on downside channel break."""

    def __init__(self, lookback: int = 20, exit_lookback: int = 10):
        if lookback < 5:
            raise ValueError("lookback must be at least 5")
        if exit_lookback < 2:
            raise ValueError("exit_lookback must be at least 2")
        if exit_lookback > lookback:
            raise ValueError("exit_lookback must not exceed lookback")
        self.lookback = lookback
        self.exit_lookback = exit_lookback

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.lookback + 1:
            return 0

        highs = df["high"].astype(float)
        lows = df["low"].astype(float)
        close = float(df["close"].iloc[-1])

        entry_high = float(highs.iloc[-self.lookback - 1 : -1].max())
        exit_low = float(lows.iloc[-self.exit_lookback - 1 : -1].min())

        if close >= entry_high:
            return 1
        if close <= exit_low:
            return -1
        return 0
