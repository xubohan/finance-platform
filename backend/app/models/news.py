"""News-related ORM models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, SmallInteger, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class NewsItem(Base):
    """Persisted market/news feed item plus downstream analysis results."""

    __tablename__ = "news_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(60), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(300), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    symbols: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, nullable=False)
    categories: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, nullable=False)
    markets: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, nullable=False)
    sentiment: Mapped[float | None] = mapped_column(Float, nullable=True)
    importance: Mapped[int] = mapped_column(SmallInteger, default=2, nullable=False)
    llm_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_impact: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_key_factors: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, nullable=False)
    processed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
