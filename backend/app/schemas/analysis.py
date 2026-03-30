"""Pydantic request schemas for analysis routes."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SentimentRequest(BaseModel):
    """Sync text sentiment request."""

    text: str = Field(..., min_length=1)
    context_symbols: list[str] = Field(default_factory=list)


class EventImpactRequest(BaseModel):
    """Async event-impact request."""

    event_text: str = Field(..., min_length=1)
    event_type: str = Field(..., min_length=1)
    symbols: list[str] = Field(default_factory=list, max_length=20)
    window_days: int = Field(20, ge=1, le=120)
