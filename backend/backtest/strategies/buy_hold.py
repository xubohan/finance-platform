"""Buy-and-hold baseline strategy."""

from __future__ import annotations

import pandas as pd

from backtest.strategies.base import BaseStrategy


class BuyHoldStrategy(BaseStrategy):
    """Buy once after the first bar and hold to the end of the window."""

    def generate_signal(self, df: pd.DataFrame) -> int:
        if len(df) == 1:
            return 1
        return 0
