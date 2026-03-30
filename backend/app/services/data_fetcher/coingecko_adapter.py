"""Crypto adapter facade."""

from __future__ import annotations

import pandas as pd

from app.services.data_fetcher.base import BaseDataFetcher
from app.services.openbb_adapter import fetch_crypto_realtime_price, fetch_ohlcv_with_meta


class CoinGeckoAdapter(BaseDataFetcher):
    """Crypto market data facade."""

    name = "coingecko"

    def fetch_ohlcv(self, symbol: str, start: str, end: str, interval: str = "1d") -> pd.DataFrame:
        frame, _ = self._call(fetch_ohlcv_with_meta, symbol, start, end, interval)
        return frame

    def fetch_quote(self, symbol: str) -> dict[str, object]:
        return self._call(fetch_crypto_realtime_price, [symbol]).get(symbol.upper(), {})

    def fetch_fundamentals(self, symbol: str, report_type: str = "income") -> dict[str, object]:
        return {}
