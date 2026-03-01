"""MACD signal-line crossover strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class MACDSignalStrategy(BaseStrategy):
    """Buy when DIF crosses above DEA, sell on downward cross."""

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < 35:
            return 0

        ema12 = df["close"].ewm(span=12, adjust=False).mean()
        ema26 = df["close"].ewm(span=26, adjust=False).mean()
        dif = ema12 - ema26
        dea = dif.ewm(span=9, adjust=False).mean()

        if dif.iloc[-2] <= dea.iloc[-2] and dif.iloc[-1] > dea.iloc[-1]:
            return 1
        if dif.iloc[-2] >= dea.iloc[-2] and dif.iloc[-1] < dea.iloc[-1]:
            return -1
        return 0
