"""RSI oversold/overbought reversal strategy."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backtest.strategies.base import BaseStrategy


class RSIReversalStrategy(BaseStrategy):
    """Buy below oversold threshold, sell above overbought threshold."""

    def __init__(self, period: int = 14, oversold: float = 30.0, overbought: float = 70.0):
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period + 1:
            return 0

        delta = df["close"].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)

        avg_gain = gain.ewm(alpha=1 / self.period, min_periods=self.period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1 / self.period, min_periods=self.period, adjust=False).mean()

        rs = avg_gain / avg_loss.replace(0, np.nan)
        rsi = 100 - 100 / (1 + rs)
        rsi = rsi.mask((avg_loss == 0) & (avg_gain > 0), 100.0)
        rsi = rsi.mask((avg_gain == 0) & (avg_loss > 0), 0.0)
        rsi = rsi.mask((avg_gain == 0) & (avg_loss == 0), 50.0)

        last = float(rsi.iloc[-1])
        if last <= self.oversold:
            return 1
        if last >= self.overbought:
            return -1
        return 0
