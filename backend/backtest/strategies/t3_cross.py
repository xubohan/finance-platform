"""T3 moving-average crossover strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class T3CrossStrategy(BaseStrategy):
    """Buy when fast T3 crosses above slow T3, sell on reverse cross."""

    def __init__(self, fast: int = 5, slow: int = 20, volume_factor: float = 0.7):
        if fast < 2:
            raise ValueError("fast must be at least 2")
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        if volume_factor <= 0 or volume_factor >= 1:
            raise ValueError("volume_factor must be within (0, 1)")
        self.fast = fast
        self.slow = slow
        self.volume_factor = volume_factor

    def _t3(self, series: pd.Series, span: int) -> pd.Series:
        ema1 = series.ewm(span=span, adjust=False).mean()
        ema2 = ema1.ewm(span=span, adjust=False).mean()
        ema3 = ema2.ewm(span=span, adjust=False).mean()
        ema4 = ema3.ewm(span=span, adjust=False).mean()
        ema5 = ema4.ewm(span=span, adjust=False).mean()
        ema6 = ema5.ewm(span=span, adjust=False).mean()

        a = self.volume_factor
        c1 = -a**3
        c2 = 3 * a**2 + 3 * a**3
        c3 = -6 * a**2 - 3 * a - 3 * a**3
        c4 = 1 + 3 * a + a**3 + 3 * a**2
        return c1 * ema6 + c2 * ema5 + c3 * ema4 + c4 * ema3

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 2:
            return 0

        close = df["close"].astype(float)
        fast_line = self._t3(close, self.fast)
        slow_line = self._t3(close, self.slow)

        prev_fast = fast_line.iloc[-2]
        prev_slow = slow_line.iloc[-2]
        curr_fast = fast_line.iloc[-1]
        curr_slow = slow_line.iloc[-1]
        if pd.isna(prev_fast) or pd.isna(prev_slow) or pd.isna(curr_fast) or pd.isna(curr_slow):
            return 0
        if prev_fast <= prev_slow and curr_fast > curr_slow:
            return 1
        if prev_fast >= prev_slow and curr_fast < curr_slow:
            return -1
        return 0
