"""Market data HTTP routes (search, kline, realtime, movers)."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.openbb_adapter import (
    detect_provider,
    fetch_crypto_realtime_price,
    fetch_ohlcv,
    fetch_stock_snapshot,
)

router = APIRouter()


def _error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    """Project-wide API error response shape."""
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
        "request_id": "",
    }


def _to_float(value: Decimal | float | int | None) -> float | None:
    """Convert DB numeric values to JSON-safe float."""
    if value is None:
        return None
    return float(value)


async def _upsert_ohlcv_rows(
    db: AsyncSession,
    symbol: str,
    asset_type: str,
    rows: list[dict[str, float | str | Any]],
) -> None:
    """Insert/update OHLCV rows idempotently."""
    if not rows:
        return

    insert_stmt = text(
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
    await db.execute(insert_stmt, rows)
    await db.commit()


@router.get("/search")
async def search_assets(
    q: str = Query(..., min_length=1),
    type: str = Query("all", pattern="^(all|stock|crypto)$"),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Unified search endpoint for stock and crypto assets."""
    keyword = q.strip()
    params: dict[str, Any] = {"kw": f"%{keyword}%", "limit": limit}

    filter_sql = ""
    if type != "all":
        filter_sql = " AND asset_type = :asset_type "
        params["asset_type"] = type

    stmt = text(
        f"""
        SELECT symbol, name, asset_type, market
        FROM assets
        WHERE (symbol ILIKE :kw OR name ILIKE :kw)
        {filter_sql}
        ORDER BY symbol
        LIMIT :limit
        """
    )
    result = await db.execute(stmt, params)

    rows = [
        {
            "symbol": row.symbol,
            "name": row.name,
            "asset_type": row.asset_type,
            "market": row.market,
        }
        for row in result.fetchall()
    ]

    return {"data": rows, "meta": {"count": len(rows)}}


@router.get("/{symbol}/kline")
async def get_kline(
    symbol: str,
    period: str = Query("1d", pattern="^(1d|1W|1M)$"),
    start: str | None = Query(None),
    end: str | None = Query(None),
    refresh_latest: bool = Query(True),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get Kline data from DB, fallback to adapter fetch and persist."""
    if not end:
        end = date.today().strftime("%Y-%m-%d")
    if not start:
        start = (date.today() - timedelta(days=120)).strftime("%Y-%m-%d")
    start_obj = date.fromisoformat(start)
    end_obj = date.fromisoformat(end)

    normalized_symbol = symbol.upper()
    asset_type, _ = detect_provider(normalized_symbol)

    if refresh_latest:
        latest_df = fetch_ohlcv(symbol=normalized_symbol, start_date=start, end_date=end, interval=period)
        if not latest_df.empty:
            payload = [
                {
                    "time": row.time.to_pydatetime(),
                    "symbol": normalized_symbol,
                    "asset_type": asset_type,
                    "open": float(row.open),
                    "high": float(row.high),
                    "low": float(row.low),
                    "close": float(row.close),
                    "volume": float(row.volume),
                }
                for row in latest_df.itertuples(index=False)
            ]
            await _upsert_ohlcv_rows(db, normalized_symbol, asset_type, payload)

    query_stmt = text(
        """
        SELECT time, open, high, low, close, volume
        FROM ohlcv_daily
        WHERE symbol = :symbol
          AND asset_type = :asset_type
          AND time::date >= :start_date
          AND time::date <= :end_date
        ORDER BY time
        """
    )
    result = await db.execute(
        query_stmt,
        {
            "symbol": normalized_symbol,
            "asset_type": asset_type,
            "start_date": start_obj,
            "end_date": end_obj,
        },
    )
    rows = result.fetchall()

    if not rows:
        df = fetch_ohlcv(symbol=normalized_symbol, start_date=start, end_date=end, interval=period)
        if df.empty:
            raise HTTPException(status_code=404, detail=_error("DATA_NOT_FOUND", "No kline data", {"symbol": normalized_symbol}))

        payload = [
            {
                "time": row.time.to_pydatetime(),
                "symbol": normalized_symbol,
                "asset_type": asset_type,
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
                "volume": float(row.volume),
            }
            for row in df.itertuples(index=False)
        ]
        await _upsert_ohlcv_rows(db, normalized_symbol, asset_type, payload)

        result = await db.execute(
            query_stmt,
            {
                "symbol": normalized_symbol,
                "asset_type": asset_type,
                "start_date": start_obj,
                "end_date": end_obj,
            },
        )
        rows = result.fetchall()

    data = [
        {
            "time": row.time.isoformat(),
            "open": _to_float(row.open),
            "high": _to_float(row.high),
            "low": _to_float(row.low),
            "close": _to_float(row.close),
            "volume": _to_float(row.volume),
        }
        for row in rows
    ]

    return {"data": data, "meta": {"symbol": normalized_symbol, "period": period}}


@router.get("/{symbol}/realtime")
async def get_realtime(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Get latest quote for stock/crypto symbol."""
    normalized_symbol = symbol.upper()
    asset_type, _ = detect_provider(normalized_symbol)

    if asset_type == "crypto":
        data = fetch_crypto_realtime_price([normalized_symbol])
        if normalized_symbol not in data:
            raise HTTPException(
                status_code=502,
                detail=_error("UPSTREAM_UNAVAILABLE", "Unable to fetch realtime price", {"symbol": normalized_symbol}),
            )
        quote = data[normalized_symbol]
        return {
            "data": {
                "symbol": normalized_symbol,
                "price": quote["price"],
                "change_pct_24h": quote.get("change_pct_24h", 0),
            }
        }

    latest_df = fetch_ohlcv(
        symbol=normalized_symbol,
        start_date=(date.today() - timedelta(days=10)).strftime("%Y-%m-%d"),
        end_date=date.today().strftime("%Y-%m-%d"),
        interval="1d",
    )
    if not latest_df.empty:
        payload = [
            {
                "time": row.time.to_pydatetime(),
                "symbol": normalized_symbol,
                "asset_type": "stock",
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
                "volume": float(row.volume),
            }
            for row in latest_df.itertuples(index=False)
        ]
        await _upsert_ohlcv_rows(db, normalized_symbol, "stock", payload)

    stmt = text(
        """
        SELECT close, time
        FROM ohlcv_daily
        WHERE symbol = :symbol AND asset_type = 'stock'
        ORDER BY time DESC
        LIMIT 2
        """
    )
    result = await db.execute(stmt, {"symbol": normalized_symbol})
    rows = result.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail=_error("DATA_NOT_FOUND", "No price data", {"symbol": normalized_symbol}))

    latest = _to_float(rows[0].close) or 0
    prev = _to_float(rows[1].close) if len(rows) > 1 else latest
    change_pct = ((latest - prev) / prev * 100) if prev else 0

    return {
        "data": {
            "symbol": normalized_symbol,
            "price": latest,
            "change_pct_24h": round(change_pct, 4),
        }
    }


@router.get("/top-movers")
async def top_movers(
    type: str = Query("stock", pattern="^(stock|crypto)$"),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return top gainers/losers from latest two data points per symbol."""
    if type == "stock":
        snapshot = fetch_stock_snapshot(market="all", limit=max(limit * 3, 60))
        stock_rows = [row for row in snapshot if row.get("change_pct") is not None and row.get("last_price") is not None]
        stock_rows.sort(key=lambda r: float(r["change_pct"]), reverse=True)
        data = [
            {
                "symbol": str(row["symbol"]).upper(),
                "change_pct": round(float(row["change_pct"]), 4),
                "latest": float(row["last_price"]),
            }
            for row in stock_rows[:limit]
        ]
        return {"data": data, "meta": {"count": len(data), "type": type}}

    stmt = text(
        """
        WITH ranked AS (
            SELECT symbol, asset_type, close, time,
                   ROW_NUMBER() OVER (PARTITION BY symbol, asset_type ORDER BY time DESC) AS rn
            FROM ohlcv_daily
            WHERE asset_type = :asset_type
        ), pair AS (
            SELECT symbol,
                   MAX(CASE WHEN rn = 1 THEN close END) AS latest,
                   MAX(CASE WHEN rn = 2 THEN close END) AS prev
            FROM ranked
            WHERE rn <= 2
            GROUP BY symbol
        )
        SELECT symbol,
               latest,
               prev,
               ((latest - prev) / NULLIF(prev, 0)) * 100 AS change_pct
        FROM pair
        WHERE prev IS NOT NULL
        ORDER BY change_pct DESC
        LIMIT :limit
        """
    )

    result = await db.execute(stmt, {"asset_type": type, "limit": limit})
    rows = result.fetchall()

    data = [
        {
            "symbol": row.symbol,
            "change_pct": round(_to_float(row.change_pct) or 0, 4),
            "latest": _to_float(row.latest),
        }
        for row in rows
    ]

    return {"data": data, "meta": {"count": len(data), "type": type}}
