"""Backtest task/result ORM models."""

from datetime import date, datetime
from decimal import Decimal
import uuid

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class BacktestTask(Base):
    """Backtest job metadata and execution status."""

    __tablename__ = "backtest_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(10), nullable=False)
    strategy_name: Mapped[str] = mapped_column(String(50), nullable=False)
    parameters: Mapped[dict] = mapped_column(JSONB, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    initial_capital: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("1000000"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class BacktestResult(Base):
    """Computed backtest metrics and output curves."""

    __tablename__ = "backtest_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("backtest_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )

    total_return: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    annual_return: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    sharpe_ratio: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    max_drawdown: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    win_rate: Mapped[Decimal | None] = mapped_column(Numeric(10, 4), nullable=True)
    trade_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    equity_curve: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    trade_records: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
