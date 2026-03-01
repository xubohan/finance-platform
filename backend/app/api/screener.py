"""Stock screener API routes."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.openbb_adapter import fetch_stock_snapshot, fetch_stock_symbols

router = APIRouter()


class ScreenerRequest(BaseModel):
    """Stock screener request schema with market and freshness controls."""

    min_pe: float | None = None
    max_pe: float | None = None
    min_roe: float | None = None
    min_profit_yoy: float | None = None
    market: Literal["us", "cn", "all"] = "us"
    refresh_latest: bool = True
    symbol_limit: int = Field(40, ge=10, le=300)
    limit: int = Field(50, ge=1, le=200)


def _to_float(value: Any) -> float | None:
    """Convert numeric-like value to float."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def _refresh_latest_fundamentals(db: AsyncSession, payload: ScreenerRequest) -> dict[str, int]:
    """Fetch latest market snapshot from upstream and upsert into DB."""
    rows = fetch_stock_snapshot(payload.market, payload.symbol_limit)
    if not rows:
        return {"symbols": 0, "fundamentals": 0}

    usable = [
        row
        for row in rows
        if _to_float(row.get("pe_ttm")) is not None
        or _to_float(row.get("roe")) is not None
        or _to_float(row.get("profit_yoy")) is not None
    ]
    if not usable:
        return {"symbols": len(rows), "fundamentals": 0}

    assets_stmt = text(
        """
        INSERT INTO assets(symbol, name, asset_type, market, is_active)
        VALUES (:symbol, :name, 'stock', :market, TRUE)
        ON CONFLICT (symbol, asset_type) DO UPDATE SET
          name = EXCLUDED.name,
          market = EXCLUDED.market,
          is_active = TRUE
        """
    )
    await db.execute(
        assets_stmt,
        [{"symbol": str(r["symbol"]).upper(), "name": r["name"], "market": str(r["market"]).upper()} for r in usable],
    )

    today = date.today()
    fundamentals_stmt = text(
        """
        INSERT INTO fundamentals(symbol, report_date, pe_ttm, pb, roe, profit_yoy, market_cap)
        VALUES (:symbol, :report_date, :pe_ttm, :pb, :roe, :profit_yoy, :market_cap)
        ON CONFLICT (symbol, report_date) DO UPDATE SET
          pe_ttm = EXCLUDED.pe_ttm,
          pb = EXCLUDED.pb,
          roe = EXCLUDED.roe,
          profit_yoy = EXCLUDED.profit_yoy,
          market_cap = EXCLUDED.market_cap
        """
    )
    await db.execute(
        fundamentals_stmt,
        [
            {
                "symbol": str(r["symbol"]).upper(),
                "report_date": today,
                "pe_ttm": _to_float(r.get("pe_ttm")),
                "pb": _to_float(r.get("pb")),
                "roe": _to_float(r.get("roe")),
                "profit_yoy": _to_float(r.get("profit_yoy")),
                "market_cap": _to_float(r.get("market_cap")),
            }
            for r in usable
        ],
    )
    await db.commit()
    return {"symbols": len(rows), "fundamentals": len(usable)}


@router.get("/symbols")
async def get_screener_symbols(
    market: Literal["us", "cn", "all"] = Query("us"),
    limit: int = Query(50, ge=10, le=300),
) -> dict[str, Any]:
    """Fetch latest stock symbol list by market (US / CN)."""
    rows = fetch_stock_symbols(market, limit)
    return {"data": rows, "meta": {"count": len(rows), "market": market}}


@router.post("/run")
async def run_screener(payload: ScreenerRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Run stock screener with market split and latest-fundamental refresh."""
    refresh_stats = {"symbols": 0, "fundamentals": 0}
    if payload.refresh_latest:
        refresh_stats = await _refresh_latest_fundamentals(db, payload)

    conditions = ["a.asset_type = 'stock'", "a.is_active = TRUE"]
    params: dict[str, Any] = {"limit": payload.limit}

    if payload.market != "all":
        conditions.append("a.market = :market")
        params["market"] = payload.market.upper()

    if payload.min_pe is not None:
        conditions.append("f.pe_ttm >= :min_pe")
        params["min_pe"] = payload.min_pe
    if payload.max_pe is not None:
        conditions.append("f.pe_ttm <= :max_pe")
        params["max_pe"] = payload.max_pe
    if payload.min_roe is not None:
        conditions.append("f.roe >= :min_roe")
        params["min_roe"] = payload.min_roe
    if payload.min_profit_yoy is not None:
        conditions.append("f.profit_yoy >= :min_profit_yoy")
        params["min_profit_yoy"] = payload.min_profit_yoy

    stmt = text(
        f"""
        WITH latest_f AS (
            SELECT DISTINCT ON (symbol)
                   symbol, pe_ttm, roe, profit_yoy
            FROM fundamentals
            ORDER BY symbol, report_date DESC
        )
        SELECT a.symbol, a.name, a.market, f.pe_ttm, f.roe, f.profit_yoy
        FROM assets a
        JOIN latest_f f ON a.symbol = f.symbol
        WHERE {' AND '.join(conditions)}
        ORDER BY f.roe DESC NULLS LAST
        LIMIT :limit
        """
    )

    result = await db.execute(stmt, params)
    rows = [dict(r._mapping) for r in result.fetchall()]
    return {
        "data": rows,
        "meta": {
            "count": len(rows),
            "market": payload.market,
            "refresh_latest": payload.refresh_latest,
            "symbols_fetched": refresh_stats["symbols"],
            "fundamentals_upserted": refresh_stats["fundamentals"],
        },
    }
