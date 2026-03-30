"""US equity adapter facade."""

from __future__ import annotations

from datetime import date
from typing import Any

import pandas as pd

from app.services.data_fetcher.base import BaseDataFetcher
from app.services.openbb_adapter import fetch_fundamentals, fetch_ohlcv_with_meta


class YFinanceAdapter(BaseDataFetcher):
    """US equity data facade backed by the current market adapter helpers."""

    name = "yfinance"

    def fetch_ohlcv(self, symbol: str, start: str, end: str, interval: str = "1d") -> pd.DataFrame:
        frame, _ = self._call(fetch_ohlcv_with_meta, symbol, start, end, interval)
        return frame

    def fetch_quote(self, symbol: str) -> dict[str, Any]:
        end_date = date.today().isoformat()
        frame, meta = self._call(fetch_ohlcv_with_meta, symbol, end_date, end_date, "1d")
        latest = frame.iloc[-1] if not frame.empty else None
        return {
            "symbol": symbol.upper(),
            "price": float(latest["close"]) if latest is not None else None,
            "as_of": latest["time"].isoformat() if latest is not None else None,
            "provider": meta.get("provider"),
            "fetch_source": meta.get("fetch_source"),
        }

    def fetch_fundamentals(self, symbol: str, report_type: str = "income") -> Any:
        return self._call(fetch_fundamentals, symbol)
