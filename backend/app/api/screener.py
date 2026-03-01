"""Stock screener API routes."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


class ScreenerRequest(BaseModel):
    """Simple stock screener request schema."""

    min_pe: float | None = None
    max_pe: float | None = None
    min_roe: float | None = None
    min_profit_yoy: float | None = None
    limit: int = Field(50, ge=1, le=200)


def _error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details or {}},
        "request_id": "",
    }


def _fallback_rows() -> list[dict[str, Any]]:
    """Fallback stock universe used when DB fundamentals are empty."""
    return [
        {"symbol": "AAPL", "name": "Apple", "pe_ttm": 28.0, "roe": 150.0, "profit_yoy": 8.0},
        {"symbol": "MSFT", "name": "Microsoft", "pe_ttm": 34.0, "roe": 38.0, "profit_yoy": 16.0},
        {"symbol": "NVDA", "name": "NVIDIA", "pe_ttm": 62.0, "roe": 76.0, "profit_yoy": 90.0},
        {"symbol": "AMZN", "name": "Amazon", "pe_ttm": 44.0, "roe": 22.0, "profit_yoy": 28.0},
        {"symbol": "GOOGL", "name": "Alphabet", "pe_ttm": 24.0, "roe": 28.0, "profit_yoy": 14.0},
    ]


def _passes(value: float | None, min_value: float | None = None, max_value: float | None = None) -> bool:
    """Apply nullable numeric range filter with SQL-like NULL behavior."""
    if value is None:
        return min_value is None and max_value is None
    if min_value is not None and value < min_value:
        return False
    if max_value is not None and value > max_value:
        return False
    return True


def _filter_fallback_rows(payload: ScreenerRequest) -> list[dict[str, Any]]:
    """Filter fallback rows with the same semantics as SQL conditions."""
    out: list[dict[str, Any]] = []
    for row in _fallback_rows():
        if not _passes(row.get("pe_ttm"), payload.min_pe, payload.max_pe):
            continue
        if not _passes(row.get("roe"), payload.min_roe, None):
            continue
        if not _passes(row.get("profit_yoy"), payload.min_profit_yoy, None):
            continue
        out.append(row)

    out.sort(key=lambda r: (r.get("roe") is None, -(float(r["roe"]) if r.get("roe") is not None else 0.0)))
    return out[: payload.limit]


@router.post("/run")
async def run_screener(payload: ScreenerRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Run stock-only filters on latest fundamentals."""
    conditions = ["a.asset_type = 'stock'", "a.is_active = TRUE"]
    params: dict[str, Any] = {"limit": payload.limit}

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
        SELECT a.symbol, a.name, f.pe_ttm, f.roe, f.profit_yoy
        FROM assets a
        JOIN latest_f f ON a.symbol = f.symbol
        WHERE {' AND '.join(conditions)}
        ORDER BY f.roe DESC NULLS LAST
        LIMIT :limit
        """
    )

    result = await db.execute(stmt, params)
    rows = [dict(r._mapping) for r in result.fetchall()]

    if not rows:
        universe_stmt = text(
            """
            WITH latest_f AS (
                SELECT DISTINCT ON (symbol)
                       symbol
                FROM fundamentals
                ORDER BY symbol, report_date DESC
            )
            SELECT 1
            FROM assets a
            JOIN latest_f f ON a.symbol = f.symbol
            WHERE a.asset_type = 'stock'
              AND a.is_active = TRUE
            LIMIT 1
            """
        )
        has_universe = (await db.execute(universe_stmt)).first() is not None
        if not has_universe:
            logger.info("Screener fallback dataset is used because stock fundamentals are empty.")
            rows = _filter_fallback_rows(payload)

    return {"data": rows, "meta": {"count": len(rows)}}
