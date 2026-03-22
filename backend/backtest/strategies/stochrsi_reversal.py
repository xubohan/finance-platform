"""Stochastic RSI reversal strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class StochRSIReversalStrategy(BaseStrategy):
    """Buy when Stoch RSI falls into oversold, sell when it rises into overbought."""

    def __init__(self, period: int = 14, oversold: float = 20.0, overbought: float = 80.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if oversold >= overbought:
            raise ValueError("oversold must be less than overbought")
        self.period = period
        self.oversold = oversold
        self.overbought = overbought

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) <= self.period * 2:
            return 0

        close = df["close"].astype(float)
        delta = close.diff()
        gains = delta.clip(lower=0.0)
        losses = -delta.clip(upper=0.0)
        avg_gain = gains.rolling(self.period).mean()
        avg_loss = losses.rolling(self.period).mean()
        rs = avg_gain / avg_loss.replace(0, float("nan"))
        rsi = 100 - 100 / (1 + rs)

        rsi_low = rsi.rolling(self.period).min()
        rsi_high = rsi.rolling(self.period).max()
        spread = rsi_high - rsi_low
        stoch_rsi = ((rsi - rsi_low) / spread.replace(0, float("nan"))) * 100
        flat_window = spread == 0
        stoch_rsi = stoch_rsi.where(~flat_window, 0.0)

        last_value = stoch_rsi.iloc[-1]
        if pd.isna(last_value):
            return 0
        if float(last_value) <= self.oversold:
            return 1
        if float(last_value) >= self.overbought:
            return -1
        return 0
