"""Event-related ORM models."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MarketEvent(Base):
    """Canonical market event table for calendar and impact workflows."""

    __tablename__ = "market_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    event_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    symbols: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, nullable=False)
    markets: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    importance: Mapped[int] = mapped_column(SmallInteger, default=3, nullable=False)
    source: Mapped[str | None] = mapped_column(String(60), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class EventImpactRecord(Base):
    """Historical post-event impact statistics per symbol."""

    __tablename__ = "event_impact_records"
    __table_args__ = (UniqueConstraint("event_id", "symbol", name="uq_event_impact_event_symbol"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("market_events.id", ondelete="CASCADE"), nullable=False)
    symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(10), nullable=False)
    t_minus_5d_ret: Mapped[float | None] = mapped_column(Float, nullable=True)
    t_minus_1d_ret: Mapped[float | None] = mapped_column(Float, nullable=True)
    t_plus_1d_ret: Mapped[float | None] = mapped_column(Float, nullable=True)
    t_plus_3d_ret: Mapped[float | None] = mapped_column(Float, nullable=True)
    t_plus_5d_ret: Mapped[float | None] = mapped_column(Float, nullable=True)
    t_plus_20d_ret: Mapped[float | None] = mapped_column(Float, nullable=True)
    vol_ratio_1d: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_drawdown: Mapped[float | None] = mapped_column(Float, nullable=True)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
