"""Fundamental data ORM model for stocks only."""

from datetime import date
from decimal import Decimal

from sqlalchemy import Date, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Fundamental(Base):
    """Stock fundamental metrics by report date."""

    __tablename__ = "fundamentals"
    __table_args__ = (UniqueConstraint("symbol", "report_date", name="uq_fundamentals_symbol_report_date"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    report_date: Mapped[date] = mapped_column(Date, nullable=False)

    pe_ttm: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    pb: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    roe: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    revenue: Mapped[Decimal | None] = mapped_column(Numeric(24, 2), nullable=True)
    net_income: Mapped[Decimal | None] = mapped_column(Numeric(24, 2), nullable=True)
    revenue_yoy: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    profit_yoy: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    market_cap: Mapped[Decimal | None] = mapped_column(Numeric(24, 2), nullable=True)
