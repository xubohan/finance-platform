"""Chande Momentum Oscillator reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class CMOReversalStrategy(BaseStrategy):
    """Buy in deep negative momentum and sell in overextended positive momentum."""

    def __init__(self, period: int = 14, oversold: float = -50.0, overbought: float = 50.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if oversold <= -100 or overbought >= 100:
            raise ValueError("cmo thresholds must stay within (-100, 100)")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period:
            return 0

        close = df["close"].astype(float)
        delta = close.diff()
        gains = delta.clip(lower=0.0).rolling(self.period).sum()
        losses = (-delta.clip(upper=0.0)).rolling(self.period).sum()
        denominator = (gains + losses).replace(0, float("nan"))
        cmo = 100 * (gains - losses) / denominator

        last_cmo = cmo.iloc[-1]
        if pd.isna(last_cmo):
            return 0
        if float(last_cmo) <= self.oversold:
            return 1
        if float(last_cmo) >= self.overbought:
            return -1
        return 0
