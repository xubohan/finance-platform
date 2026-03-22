"""McGinley Dynamic crossover strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class McGinleyCrossStrategy(BaseStrategy):
    """Buy when fast McGinley Dynamic crosses above slow, sell on reverse cross."""

    def __init__(self, fast: int = 8, slow: int = 21):
        if fast < 2:
            raise ValueError("fast must be at least 2")
        if slow <= fast:
            raise ValueError("slow must be greater than fast")
        self.fast = fast
        self.slow = slow

    @staticmethod
    def _mcginley(series: pd.Series, period: int) -> pd.Series:
        dynamic = pd.Series(index=series.index, dtype=float)
        if series.empty:
            return dynamic
        dynamic.iloc[0] = float(series.iloc[0])
        for idx in range(1, len(series)):
            prev = dynamic.iloc[idx - 1]
            price = float(series.iloc[idx])
            if prev == 0:
                dynamic.iloc[idx] = price
                continue
            ratio = max(price / prev, 1e-6)
            denominator = period * ratio**4
            dynamic.iloc[idx] = prev + (price - prev) / denominator
        return dynamic

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.slow + 2:
            return 0

        close = df["close"].astype(float)
        fast_line = self._mcginley(close, self.fast)
        slow_line = self._mcginley(close, self.slow)

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
