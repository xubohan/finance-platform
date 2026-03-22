"""Chaikin money flow trend strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class ChaikinMoneyFlowTrendStrategy(BaseStrategy):
    """Buy on positive money-flow dominance and sell on negative dominance."""

    def __init__(self, period: int = 20, threshold: float = 0.05):
        if period < 5:
            raise ValueError("period must be at least 5")
        if threshold <= 0:
            raise ValueError("threshold must be positive")
        self.period = period
        self.threshold = threshold

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period:
            return 0

        high = df["high"].astype(float)
        low = df["low"].astype(float)
        close = df["close"].astype(float)
        volume = df["volume"].astype(float)

        spread = (high - low).replace(0, float("nan"))
        money_flow_multiplier = ((close - low) - (high - close)) / spread
        money_flow_multiplier = money_flow_multiplier.fillna(0.0)
        money_flow_volume = money_flow_multiplier * volume

        cmf = money_flow_volume.rolling(self.period).sum() / volume.rolling(self.period).sum().replace(0, float("nan"))
        last_cmf = cmf.iloc[-1]
        if pd.isna(last_cmf):
            return 0
        if float(last_cmf) >= self.threshold:
            return 1
        if float(last_cmf) <= -self.threshold:
            return -1
        return 0
