"""Shared local OHLCV storage helpers."""

from __future__ import annotations

from datetime import timezone
from typing import Any

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.openbb_adapter import fetch_ohlcv_with_meta

LOCAL_COVERAGE_TOLERANCE_DAYS = 5


def _to_utc_timestamp(value: str | pd.Timestamp) -> pd.Timestamp:
    ts = pd.to_datetime(value, utc=True)
    if pd.isna(ts):
        raise ValueError(f"invalid timestamp: {value}")
    return ts


def normalize_ohlcv_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """Normalize upstream/local OHLCV shape into a stable UTC-sorted frame."""
    if frame.empty:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    normalized = frame.copy()
    normalized["time"] = pd.to_datetime(normalized["time"], utc=True)
    normalized = normalized.sort_values("time").drop_duplicates(subset=["time"], keep="last")

    for field in ("open", "high", "low", "close", "volume"):
        normalized[field] = normalized[field].astype(float)

    return normalized.reset_index(drop=True)[["time", "open", "high", "low", "close", "volume"]]


def build_ohlcv_rows(frame: pd.DataFrame, symbol: str, asset_type: str) -> list[dict[str, Any]]:
    """Convert normalized dataframe to DB payload rows."""
    normalized = normalize_ohlcv_frame(frame)
    return [
        {
            "time": row.time.to_pydatetime(),
            "symbol": symbol,
            "asset_type": asset_type,
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
        }
        for row in normalized.itertuples(index=False)
    ]


async def upsert_ohlcv_rows(
    db: AsyncSession | None,
    symbol: str,
    asset_type: str,
    rows: list[dict[str, Any]],
) -> None:
    """Insert/update OHLCV rows idempotently."""
    if db is None or not rows:
        return

    await db.execute(
        text(
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
        ),
        rows,
    )
    await db.commit()


async def read_local_ohlcv(
    db: AsyncSession | None,
    symbol: str,
    asset_type: str,
    start: str | pd.Timestamp,
    end: str | pd.Timestamp,
) -> pd.DataFrame:
    """Read OHLCV rows for a symbol from local storage."""
    if db is None:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    start_ts = _to_utc_timestamp(start)
    end_ts = _to_utc_timestamp(end)
    result = await db.execute(
        text(
            """
            SELECT time, open, high, low, close, volume
            FROM ohlcv_daily
            WHERE symbol = :symbol
              AND asset_type = :asset_type
              AND time >= :start_ts
              AND time <= :end_ts
            ORDER BY time
            """
        ),
        {
            "symbol": symbol,
            "asset_type": asset_type,
            "start_ts": start_ts.to_pydatetime(),
            "end_ts": end_ts.to_pydatetime(),
        },
    )
    rows = result.fetchall()
    if not rows:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    return normalize_ohlcv_frame(
        pd.DataFrame(
            [
                {
                    "time": row.time,
                    "open": float(row.open),
                    "high": float(row.high),
                    "low": float(row.low),
                    "close": float(row.close),
                    "volume": float(row.volume),
                }
                for row in rows
            ]
        )
    )


async def get_local_ohlcv_summary(
    db: AsyncSession | None,
    symbol: str,
    asset_type: str,
) -> dict[str, Any]:
    """Return lightweight local coverage information for a symbol."""
    if db is None:
        return {"count": 0, "start": None, "end": None}

    result = await db.execute(
        text(
            """
            SELECT COUNT(*) AS count, MIN(time) AS start_time, MAX(time) AS end_time
            FROM ohlcv_daily
            WHERE symbol = :symbol
              AND asset_type = :asset_type
            """
        ),
        {"symbol": symbol, "asset_type": asset_type},
    )
    row = result.one()
    start_time = row.start_time.astimezone(timezone.utc).isoformat() if row.start_time else None
    end_time = row.end_time.astimezone(timezone.utc).isoformat() if row.end_time else None
    return {
        "count": int(row.count or 0),
        "start": start_time,
        "end": end_time,
    }


def has_full_local_coverage(
    frame: pd.DataFrame,
    start: str | pd.Timestamp,
    end: str | pd.Timestamp,
    asset_type: str,
) -> bool:
    """Check whether local rows plausibly cover the full requested window."""
    if frame.empty:
        return False

    start_ts = _to_utc_timestamp(start)
    end_ts = _to_utc_timestamp(end)
    min_ts = pd.to_datetime(frame["time"].min(), utc=True)
    max_ts = pd.to_datetime(frame["time"].max(), utc=True)
    tolerance = pd.Timedelta(days=LOCAL_COVERAGE_TOLERANCE_DAYS)
    if not bool(min_ts <= start_ts + tolerance and max_ts >= end_ts - tolerance):
        return False

    normalized = normalize_ohlcv_frame(frame)
    if len(normalized) <= 1:
        return False

    freq = "D" if asset_type == "crypto" else "B"
    expected_count = len(pd.date_range(start=start_ts, end=end_ts, freq=freq))
    if expected_count <= 0:
        return False

    minimum_ratio = 0.97 if asset_type == "crypto" else 0.9
    if len(normalized) / expected_count < minimum_ratio:
        return False

    max_gap_days = 3 if asset_type == "crypto" else 10
    gaps = normalized["time"].diff().dropna()
    if not gaps.empty and gaps.max() > pd.Timedelta(days=max_gap_days):
        return False

    return True


async def sync_ohlcv_from_upstream(
    db: AsyncSession | None,
    symbol: str,
    asset_type: str,
    start_date: str,
    end_date: str,
    interval: str = "1d",
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Fetch live OHLCV, persist it locally, and return the normalized frame."""
    live_df, live_meta = fetch_ohlcv_with_meta(
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
        interval=interval,
    )
    normalized = normalize_ohlcv_frame(live_df)
    if interval == "1d" and not normalized.empty:
        await upsert_ohlcv_rows(db, symbol, asset_type, build_ohlcv_rows(normalized, symbol, asset_type))
    return normalized, live_meta


async def load_ohlcv_window(
    db: AsyncSession | None,
    symbol: str,
    asset_type: str,
    start_date: str,
    end_date: str,
    *,
    interval: str = "1d",
    prefer_local: bool = True,
    sync_if_missing: bool = True,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Load a requested OHLCV window from local storage first, then sync if missing."""
    local_df = await read_local_ohlcv(db, symbol, asset_type, start_date, end_date)
    if prefer_local and has_full_local_coverage(local_df, start_date, end_date, asset_type):
        last_time = local_df["time"].iloc[-1].isoformat() if not local_df.empty else None
        return local_df, {
            "source": "local",
            "stale": False,
            "as_of": last_time,
            "provider": "local",
            "fetch_source": "database",
            "sync_performed": False,
            "coverage_complete": True,
        }

    if not sync_if_missing:
        last_time = local_df["time"].iloc[-1].isoformat() if not local_df.empty else None
        return local_df, {
            "source": "local",
            "stale": False,
            "as_of": last_time,
            "provider": "local",
            "fetch_source": "database_partial",
            "sync_performed": False,
            "coverage_complete": False,
        }

    synced_df, live_meta = await sync_ohlcv_from_upstream(
        db=db,
        symbol=symbol,
        asset_type=asset_type,
        start_date=start_date,
        end_date=end_date,
        interval=interval,
    )
    if synced_df.empty:
        return synced_df, {
            "source": live_meta.get("source"),
            "stale": live_meta.get("stale"),
            "as_of": live_meta.get("as_of"),
            "provider": live_meta.get("provider"),
            "fetch_source": live_meta.get("fetch_source"),
            "sync_performed": True,
            "coverage_complete": False,
        }

    reread_df = await read_local_ohlcv(db, symbol, asset_type, start_date, end_date)
    if not reread_df.empty and has_full_local_coverage(reread_df, start_date, end_date, asset_type):
        last_time = reread_df["time"].iloc[-1].isoformat()
        return reread_df, {
            "source": "local",
            "stale": False,
            "as_of": last_time,
            "provider": live_meta.get("provider"),
            "fetch_source": live_meta.get("fetch_source"),
            "sync_performed": True,
            "coverage_complete": True,
        }

    return synced_df, {
        "source": live_meta.get("source"),
        "stale": live_meta.get("stale"),
        "as_of": live_meta.get("as_of"),
        "provider": live_meta.get("provider"),
        "fetch_source": live_meta.get("fetch_source"),
        "sync_performed": True,
        "coverage_complete": False,
    }
