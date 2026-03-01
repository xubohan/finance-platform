"""Celery tasks for market data ingestion."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import logging

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services.openbb_adapter import detect_provider, fetch_ohlcv
from tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


async def _upsert_ohlcv(symbol: str, asset_type: str, rows: list[dict]) -> int:
    """Persist OHLCV rows into Timescale table with idempotent upsert."""
    if not rows:
        return 0

    stmt = text(
        """
        INSERT INTO ohlcv_daily(time, symbol, asset_type, open, high, low, close, volume)
        VALUES (:time, :symbol, :asset_type, :open, :high, :low, :close, :volume)
        ON CONFLICT (time, symbol, asset_type) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume
        """
    )

    async with AsyncSessionLocal() as session:
        await session.execute(stmt, rows)
        await session.commit()

    return len(rows)


@celery_app.task(name="tasks.data_tasks.sync_symbol")
def sync_symbol(symbol: str, start_date: str | None = None, end_date: str | None = None) -> dict:
    """Fetch historical OHLCV for a symbol and upsert into ohlcv_daily."""
    today = datetime.utcnow().date()
    if end_date is None:
        end_date = today.strftime("%Y-%m-%d")
    if start_date is None:
        start_date = (today - timedelta(days=120)).strftime("%Y-%m-%d")

    asset_type, _ = detect_provider(symbol)
    df = fetch_ohlcv(symbol=symbol, start_date=start_date, end_date=end_date, interval="1d")

    if df.empty:
        logger.warning("sync_symbol produced empty dataframe: %s", symbol)
        return {"symbol": symbol, "inserted": 0, "asset_type": asset_type}

    rows = [
        {
            "time": row.time.to_pydatetime(),
            "symbol": symbol.upper(),
            "asset_type": asset_type,
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
        }
        for row in df.itertuples(index=False)
    ]

    inserted = asyncio.run(_upsert_ohlcv(symbol=symbol.upper(), asset_type=asset_type, rows=rows))
    return {"symbol": symbol.upper(), "inserted": inserted, "asset_type": asset_type}
