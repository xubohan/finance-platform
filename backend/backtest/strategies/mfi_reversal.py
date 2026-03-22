"""Money Flow Index reversal strategy."""

from __future__ import annotations

import numpy as np
import pandas as pd

from backtest.strategies.base import BaseStrategy


class MFIReversalStrategy(BaseStrategy):
    """Buy when MFI becomes oversold, sell when it becomes overbought."""

    def __init__(self, period: int = 14, oversold: float = 20.0, overbought: float = 80.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period + 1:
            return 0

        typical_price = (df["high"] + df["low"] + df["close"]) / 3
        raw_money_flow = typical_price * df["volume"].astype(float)
        price_diff = typical_price.diff()
        positive_flow = raw_money_flow.where(price_diff > 0, 0.0)
        negative_flow = raw_money_flow.where(price_diff < 0, 0.0).abs()

        positive_sum = positive_flow.iloc[-self.period :].sum()
        negative_sum = negative_flow.iloc[-self.period :].sum()
        if negative_sum == 0:
            mfi = 100.0 if positive_sum > 0 else 50.0
        else:
            money_ratio = positive_sum / negative_sum
            mfi = 100 - 100 / (1 + money_ratio)
        if np.isnan(mfi):
            return 0

        if mfi <= self.oversold:
            return 1
        if mfi >= self.overbought:
            return -1
        return 0
