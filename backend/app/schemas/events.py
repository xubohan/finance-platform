"""Pydantic request schemas for event routes."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class EventSearchRequest(BaseModel):
    """Free-text event search request."""

    query: str = Field(..., min_length=1)
    event_type: str = Field("", max_length=60)
    date_range: list[date] = Field(default_factory=list, max_length=2)
