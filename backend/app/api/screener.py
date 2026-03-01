"""Stock screener API routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db

router = APIRouter()


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

    return {"data": rows, "meta": {"count": len(rows)}}
