"""Asset ORM model for stocks and cryptocurrencies."""

from sqlalchemy import Boolean, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Asset(Base):
    """Unified asset table for stock and crypto instruments."""

    __tablename__ = "assets"
    __table_args__ = (UniqueConstraint("symbol", "asset_type", name="uq_assets_symbol_asset_type"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(10), nullable=False)
    market: Mapped[str | None] = mapped_column(String(10), nullable=True)
    industry: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
