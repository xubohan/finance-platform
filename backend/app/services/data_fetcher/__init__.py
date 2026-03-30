"""Fetcher interfaces and provider-specific adapters for the v2 data layer."""

from app.services.data_fetcher.akshare_adapter import AKShareAdapter
from app.services.data_fetcher.base import BaseDataFetcher, CircuitBreakerState
from app.services.data_fetcher.coingecko_adapter import CoinGeckoAdapter
from app.services.data_fetcher.yfinance_adapter import YFinanceAdapter

__all__ = [
    "BaseDataFetcher",
    "CircuitBreakerState",
    "AKShareAdapter",
    "YFinanceAdapter",
    "CoinGeckoAdapter",
]
