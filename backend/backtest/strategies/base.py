"""Base class for trading strategies."""

from __future__ import annotations

import pandas as pd


class BaseStrategy:
    """Strategy interface returning {1, 0, -1} trading signals."""

    def generate_signal(self, df: pd.DataFrame) -> int:
        raise NotImplementedError
