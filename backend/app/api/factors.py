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
from app.services.openbb_adapter import fetch_ohlcv

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


def _fallback_universe() -> pd.DataFrame:
    """Generate minimal stock universe when DB fundamentals are not ready."""
    symbols = ["AAPL", "MSFT", "NVDA"]
    rows: list[dict[str, Any]] = []

    base = {
        "AAPL": {"name": "Apple", "pe_ttm": 28.0, "roe": 150.0, "profit_yoy": 8.0},
        "MSFT": {"name": "Microsoft", "pe_ttm": 34.0, "roe": 38.0, "profit_yoy": 16.0},
        "NVDA": {"name": "NVIDIA", "pe_ttm": 62.0, "roe": 76.0, "profit_yoy": 90.0},
    }

    for sym in symbols:
        df = fetch_ohlcv(sym, "2024-01-01", "2024-03-01")
        if df.empty or len(df) < 21:
            continue
        latest = float(df.iloc[-1]["close"])
        prev = float(df.iloc[-21]["close"])
        momentum_20d = ((latest - prev) / prev) * 100 if prev else 0

        rows.append(
            {
                "symbol": sym,
                "name": base[sym]["name"],
                "pe_ttm": base[sym]["pe_ttm"],
                "profit_yoy": base[sym]["profit_yoy"],
                "momentum_20d": momentum_20d,
                "roe": base[sym]["roe"],
            }
        )

    return pd.DataFrame(rows)


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
        df = _fallback_universe()

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No stock universe for factor scoring", {}),
        )

    ranked = score_factors(df, weights=weights, top_n=payload.top_n)
    data = ranked.to_dict("records")
    return {"data": data, "meta": {"count": len(data), "top_n": payload.top_n}}
