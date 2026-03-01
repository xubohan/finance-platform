"""Factor-scoring API routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import pandas as pd

from app.database import get_db
from app.services.factor_engine import score_factors
from app.services.openbb_adapter import fetch_stock_snapshot

router = APIRouter()


class FactorWeights(BaseModel):
    """Four-factor weight configuration."""

    value: float = Field(25, ge=0, le=100)
    growth: float = Field(25, ge=0, le=100)
    momentum: float = Field(25, ge=0, le=100)
    quality: float = Field(25, ge=0, le=100)


class FactorScoreRequest(BaseModel):
    """Request schema for factor scoring."""

    weights: FactorWeights
    top_n: int = Field(50, ge=1, le=200)


def _error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details or {}},
        "request_id": "",
    }


def _snapshot_universe(top_n: int) -> pd.DataFrame:
    """Build dynamic factor universe from latest market snapshot."""
    rows = fetch_stock_snapshot(market="all", limit=max(top_n * 4, 80))
    normalized: list[dict[str, Any]] = []

    for row in rows:
        pe = row.get("pe_ttm")
        roe = row.get("roe")
        growth = row.get("profit_yoy")
        momentum = row.get("change_pct")

        if pe is None or roe is None or growth is None:
            continue
        if momentum is None:
            momentum = 0

        normalized.append(
            {
                "symbol": str(row.get("symbol", "")).upper(),
                "name": row.get("name") or str(row.get("symbol", "")).upper(),
                "pe_ttm": float(pe),
                "profit_yoy": float(growth),
                # Snapshot provides current change pct, used as short-term momentum proxy.
                "momentum_20d": float(momentum),
                "roe": float(roe),
            }
        )

    return pd.DataFrame(normalized)


@router.post("/score")
async def factors_score(payload: FactorScoreRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Calculate weighted stock factor ranking."""
    weights = payload.weights.model_dump()

    if round(sum(weights.values()), 6) != 100.0:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_WEIGHTS", "weights must sum to 100", {"weights": weights}),
        )

    stmt = text(
        """
        WITH latest_f AS (
            SELECT DISTINCT ON (symbol)
                   symbol, pe_ttm, roe, profit_yoy
            FROM fundamentals
            ORDER BY symbol, report_date DESC
        ),
        px AS (
            SELECT symbol, close, time,
                   ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY time DESC) AS rn
            FROM ohlcv_daily
            WHERE asset_type = 'stock'
        ),
        px_pair AS (
            SELECT symbol,
                   MAX(CASE WHEN rn = 1 THEN close END) AS latest_close,
                   MAX(CASE WHEN rn = 21 THEN close END) AS prev_close
            FROM px
            WHERE rn IN (1, 21)
            GROUP BY symbol
        )
        SELECT a.symbol,
               a.name,
               lf.pe_ttm,
               lf.profit_yoy,
               ((pp.latest_close - pp.prev_close) / NULLIF(pp.prev_close, 0)) * 100 AS momentum_20d,
               lf.roe
        FROM assets a
        JOIN latest_f lf ON a.symbol = lf.symbol
        JOIN px_pair pp ON a.symbol = pp.symbol
        WHERE a.asset_type = 'stock'
          AND a.is_active = TRUE
        """
    )

    result = await db.execute(stmt)
    records = [dict(r._mapping) for r in result.fetchall()]
    df = pd.DataFrame(records)

    if df.empty:
        df = _snapshot_universe(payload.top_n)

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No live stock universe for factor scoring", {}),
        )

    ranked = score_factors(df, weights=weights, top_n=payload.top_n)
    data = ranked.to_dict("records")
    return {"data": data, "meta": {"count": len(data), "top_n": payload.top_n}}
