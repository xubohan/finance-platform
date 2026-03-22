"""Rolling VWAP mean-reversion strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class VWAPReversionStrategy(BaseStrategy):
    """Buy below rolling VWAP by threshold and exit back above VWAP."""

    def __init__(self, period: int = 20, deviation_pct: float = 3.0):
        if period < 5:
            raise ValueError("period must be at least 5")
        if deviation_pct <= 0:
            raise ValueError("deviation_pct must be positive")
        self.period = period
        self.deviation_pct = deviation_pct

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) < self.period:
            return 0

        close = df["close"].astype(float)
        volume = df["volume"].astype(float)
        rolling_notional = (close * volume).rolling(self.period).sum()
        rolling_volume = volume.rolling(self.period).sum().replace(0, float("nan"))
        rolling_vwap = rolling_notional / rolling_volume

        last_close = float(close.iloc[-1])
        last_vwap = rolling_vwap.iloc[-1]
        if pd.isna(last_vwap):
            return 0

        lower_trigger = float(last_vwap) * (1 - self.deviation_pct / 100)
        if last_close <= lower_trigger:
            return 1
        if last_close >= float(last_vwap):
            return -1
        return 0
