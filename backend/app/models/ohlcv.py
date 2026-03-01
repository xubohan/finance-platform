"""OHLCV ORM model backed by TimescaleDB hypertable."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, Numeric, PrimaryKeyConstraint, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OhlcvDaily(Base):
    """Daily OHLCV records shared by stock and crypto."""

    __tablename__ = "ohlcv_daily"
    __table_args__ = (PrimaryKeyConstraint("time", "symbol", "asset_type", name="pk_ohlcv_daily"),)

    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(10), nullable=False)
    open: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    high: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    low: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    close: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    volume: Mapped[Decimal] = mapped_column(Numeric(24, 4), nullable=False)
