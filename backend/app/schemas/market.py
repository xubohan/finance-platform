"""Shared request schemas for market APIs."""

from __future__ import annotations

from pydantic import BaseModel, Field


class HistorySyncRequest(BaseModel):
    """Manual sync request for local OHLCV coverage."""

    start_date: str
    end_date: str
    period: str = Field("1d", pattern="^(1d)$")


class BatchQuoteRequest(BaseModel):
    """Batch quote request for watchlist-style workloads."""

    symbols: list[str] = Field(default_factory=list, min_length=1, max_length=25)
