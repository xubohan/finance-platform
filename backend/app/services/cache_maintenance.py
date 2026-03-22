"""Maintenance helpers for research cache tables."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "astimezone"):
        return value.astimezone(timezone.utc).isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


async def ensure_research_cache_tables(db: AsyncSession) -> None:
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS market_snapshot_daily (
              trade_date DATE NOT NULL,
              market VARCHAR(10) NOT NULL,
              symbol VARCHAR(30) NOT NULL,
              payload JSONB NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (trade_date, market, symbol)
            )
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_market_snapshot_daily_market_date
            ON market_snapshot_daily(market, trade_date DESC)
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS backtest_cache (
              cache_key VARCHAR(128) PRIMARY KEY,
              category VARCHAR(40) NOT NULL,
              request_payload JSONB NOT NULL,
              response_payload JSONB NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              expires_at TIMESTAMPTZ NOT NULL
            )
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_backtest_cache_expires_at
            ON backtest_cache(expires_at)
            """
        )
    )
    await db.commit()


async def read_cache_maintenance_summary(
    db: AsyncSession,
    *,
    snapshot_retention_days: int,
) -> dict[str, Any]:
    await ensure_research_cache_tables(db)

    now_ts = datetime.now(timezone.utc)
    cutoff_date = now_ts.date() - timedelta(days=max(1, snapshot_retention_days))

    snapshot_result = await db.execute(
        text(
            """
            SELECT
              COUNT(*) AS total_rows,
              COALESCE(SUM(CASE WHEN trade_date < :cutoff_date THEN 1 ELSE 0 END), 0) AS purgeable_rows,
              MIN(trade_date) AS oldest_trade_date,
              MAX(trade_date) AS newest_trade_date
            FROM market_snapshot_daily
            """
        ),
        {"cutoff_date": cutoff_date},
    )
    snapshot_row = snapshot_result.one()

    backtest_result = await db.execute(
        text(
            """
            SELECT
              COUNT(*) AS total_rows,
              COALESCE(SUM(CASE WHEN expires_at <= :now_ts THEN 1 ELSE 0 END), 0) AS expired_rows,
              MIN(created_at) AS oldest_created_at,
              MAX(created_at) AS newest_created_at,
              MIN(expires_at) AS oldest_expires_at,
              MAX(expires_at) AS newest_expires_at
            FROM backtest_cache
            """
        ),
        {"now_ts": now_ts},
    )
    backtest_row = backtest_result.one()

    return {
        "market_snapshot_daily": {
            "retention_days": int(snapshot_retention_days),
            "cutoff_date": cutoff_date.isoformat(),
            "total_rows": int(snapshot_row.total_rows or 0),
            "purgeable_rows": int(snapshot_row.purgeable_rows or 0),
            "oldest_trade_date": _to_iso(snapshot_row.oldest_trade_date),
            "newest_trade_date": _to_iso(snapshot_row.newest_trade_date),
        },
        "backtest_cache": {
            "total_rows": int(backtest_row.total_rows or 0),
            "expired_rows": int(backtest_row.expired_rows or 0),
            "oldest_created_at": _to_iso(backtest_row.oldest_created_at),
            "newest_created_at": _to_iso(backtest_row.newest_created_at),
            "oldest_expires_at": _to_iso(backtest_row.oldest_expires_at),
            "newest_expires_at": _to_iso(backtest_row.newest_expires_at),
        },
    }


async def cleanup_research_cache_tables(
    db: AsyncSession,
    *,
    snapshot_retention_days: int,
    dry_run: bool = True,
) -> dict[str, Any]:
    before = await read_cache_maintenance_summary(db, snapshot_retention_days=snapshot_retention_days)
    deleted_snapshot_rows = 0
    deleted_backtest_rows = 0

    if not dry_run:
        now_ts = datetime.now(timezone.utc)
        cutoff_date = now_ts.date() - timedelta(days=max(1, snapshot_retention_days))

        expired_result = await db.execute(
            text(
                """
                DELETE FROM backtest_cache
                WHERE expires_at <= :now_ts
                """
            ),
            {"now_ts": now_ts},
        )
        deleted_backtest_rows = int(expired_result.rowcount or 0)

        snapshot_result = await db.execute(
            text(
                """
                DELETE FROM market_snapshot_daily
                WHERE trade_date < :cutoff_date
                """
            ),
            {"cutoff_date": cutoff_date},
        )
        deleted_snapshot_rows = int(snapshot_result.rowcount or 0)
        await db.commit()

    after = await read_cache_maintenance_summary(db, snapshot_retention_days=snapshot_retention_days)
    return {
        "dry_run": bool(dry_run),
        "deleted_rows": {
            "market_snapshot_daily": deleted_snapshot_rows,
            "backtest_cache": deleted_backtest_rows,
        },
        "before": before,
        "after": after,
    }
