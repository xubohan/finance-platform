"""CCI mean-reversion strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class CCIReversalStrategy(BaseStrategy):
    """Buy when CCI becomes deeply negative, sell when it becomes deeply positive."""

    def __init__(self, period: int = 20, oversold: float = -100.0, overbought: float = 100.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period:
            return 0

        typical = (df["high"].astype(float) + df["low"].astype(float) + df["close"].astype(float)) / 3
        sma = typical.rolling(self.period).mean()
        mad = typical.rolling(self.period).apply(
            lambda values: float((pd.Series(values) - pd.Series(values).mean()).abs().mean()),
            raw=False,
        )
        cci = (typical - sma) / (0.015 * mad.replace(0, float("nan")))

        last_cci = cci.iloc[-1]
        if pd.isna(last_cci):
            return 0
        if float(last_cci) <= self.oversold:
            return 1
        if float(last_cci) >= self.overbought:
            return -1
        return 0
