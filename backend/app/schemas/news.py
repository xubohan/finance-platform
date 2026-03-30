"""Shared request schemas for news APIs."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class NewsFeedQuery(BaseModel):
    """Normalized query contract for news feed endpoints."""

    market: Literal["us", "cn", "crypto", "all"] = "all"
    markets: str | None = None
    query: str | None = None
    symbols: str | None = None
    category: str | None = None
    sentiment: Literal["positive", "negative", "neutral"] | None = None
    sentiment_min: float | None = Field(default=None, ge=-1, le=1)
    sentiment_max: float | None = Field(default=None, ge=-1, le=1)
    importance: int | None = Field(default=None, ge=1, le=5)
    start: str | None = None
    end: str | None = None
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)

    @model_validator(mode="after")
    def validate_sentiment_range(self) -> "NewsFeedQuery":
        """Reject inverted sentiment filters before query execution."""
        if (
            self.sentiment_min is not None
            and self.sentiment_max is not None
            and self.sentiment_min > self.sentiment_max
        ):
            raise ValueError("sentiment_min must be <= sentiment_max")
        return self
