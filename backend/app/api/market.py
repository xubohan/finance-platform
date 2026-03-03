"""Market data HTTP routes (search, kline, realtime, movers)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.openbb_adapter import (
    detect_provider,
    fetch_crypto_realtime_price,
    fetch_ohlcv,
    fetch_stock_snapshot_with_meta,
    fetch_stock_symbols,
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
    """Unified search endpoint with live stock universe."""
    keyword = q.strip()
    keyword_upper = keyword.upper()
    rows: list[dict[str, Any]] = []

    if type in ("all", "stock"):
        live_universe = fetch_stock_symbols(market="all", limit=600, force_refresh=True, allow_stale=False)
        if not live_universe and type == "stock":
            raise HTTPException(
                status_code=502,
                detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest stock symbol universe", {}),
            )
        for item in live_universe:
            symbol = str(item.get("symbol", "")).upper()
            name = str(item.get("name", ""))
            if keyword_upper in symbol or keyword_upper in name.upper():
                rows.append(
                    {
                        "symbol": symbol,
                        "name": name,
                        "asset_type": "stock",
                        "market": item.get("market"),
                    }
                )
                if len(rows) >= limit:
                    return {"data": rows, "meta": {"count": len(rows)}}

    if type in ("all", "crypto") and len(rows) < limit:
        stmt = text(
            """
            SELECT symbol, name, asset_type, market
            FROM assets
            WHERE asset_type = 'crypto'
              AND (symbol ILIKE :kw OR name ILIKE :kw)
            ORDER BY symbol
            LIMIT :limit
            """
        )
        result = await db.execute(stmt, {"kw": f"%{keyword}%", "limit": limit - len(rows)})
        rows.extend(
            [
                {
                    "symbol": row.symbol,
                    "name": row.name,
                    "asset_type": row.asset_type,
                    "market": row.market,
                }
                for row in result.fetchall()
            ]
        )

    return {"data": rows[:limit], "meta": {"count": len(rows[:limit])}}


@router.get("/{symbol}/kline")
async def get_kline(
    symbol: str,
    period: str = Query("1d", pattern="^(1d|1W|1M)$"),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get latest Kline data from live upstream and persist."""
    if not end:
        end = date.today().strftime("%Y-%m-%d")
    if not start:
        start = (date.today() - timedelta(days=120)).strftime("%Y-%m-%d")

    normalized_symbol = symbol.upper()
    asset_type, _ = detect_provider(normalized_symbol)

    latest_df = fetch_ohlcv(symbol=normalized_symbol, start_date=start, end_date=end, interval=period)
    if latest_df.empty:
        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest kline data", {"symbol": normalized_symbol}),
        )

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

    data = [
        {
            "time": row.time.isoformat(),
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
        }
        for row in latest_df.itertuples(index=False)
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
    if latest_df.empty:
        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest quote data", {"symbol": normalized_symbol}),
        )

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

    latest = float(latest_df.iloc[-1]["close"])
    prev = float(latest_df.iloc[-2]["close"]) if len(latest_df) > 1 else latest
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
    force_refresh: bool = Query(True),
    allow_stale: bool = Query(False),
) -> dict[str, Any]:
    """Return top movers from live upstream feeds."""
    if type == "stock":
        snapshot, snapshot_meta = fetch_stock_snapshot_with_meta(
            market="all",
            limit=max(limit * 3, 60),
            force_refresh=force_refresh,
            allow_stale=allow_stale,
        )
        if not snapshot:
            raise HTTPException(
                status_code=502,
                detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest stock movers", {}),
            )
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
        return {
            "data": data,
            "meta": {
                "count": len(data),
                "type": type,
                "source": snapshot_meta.get("source"),
                "stale": snapshot_meta.get("stale"),
                "as_of": snapshot_meta.get("as_of"),
                "cache_age_sec": snapshot_meta.get("cache_age_sec"),
                "refresh_in_progress": False,
            },
        }

    tracked = ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "DOGE", "DOT"]
    quotes = fetch_crypto_realtime_price(tracked)
    if not quotes:
        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest crypto movers", {}),
        )
    data = [
        {
            "symbol": symbol,
            "change_pct": round(float(item.get("change_pct_24h", 0) or 0), 4),
            "latest": float(item.get("price", 0) or 0),
        }
        for symbol, item in quotes.items()
    ]
    data.sort(key=lambda r: r["change_pct"], reverse=True)

    return {
        "data": data[:limit],
        "meta": {
            "count": min(len(data), limit),
            "type": type,
            "source": "live",
            "stale": False,
            "as_of": None,
            "cache_age_sec": None,
            "refresh_in_progress": False,
        },
    }
