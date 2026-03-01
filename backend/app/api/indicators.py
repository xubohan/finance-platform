"""Indicator calculation API routes."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.services.indicator_engine import calculate_indicators
from app.services.openbb_adapter import fetch_ohlcv

router = APIRouter()

SUPPORTED = {"MA", "EMA", "MACD", "RSI", "BOLL", "BOLLINGER", "KDJ"}


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


@router.get("/{symbol}/calc")
async def calc_indicators(
    symbol: str,
    names: str = Query(..., min_length=1, description="Comma-separated names, e.g. MA,MACD"),
    start: str | None = Query(None),
    end: str | None = Query(None),
    period: str = Query("1d", pattern="^(1d|1W|1M)$"),
) -> dict[str, Any]:
    """Calculate selected indicators for symbol OHLCV history."""
    if not end:
        end = date.today().strftime("%Y-%m-%d")
    if not start:
        start = (date.today() - timedelta(days=180)).strftime("%Y-%m-%d")

    requested = [n.strip().upper() for n in names.split(",") if n.strip()]
    invalid = [n for n in requested if n not in SUPPORTED]
    if invalid:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_INDICATOR", "Unsupported indicator", {"names": invalid}),
        )

    df = fetch_ohlcv(symbol=symbol.upper(), start_date=start, end_date=end, interval=period)
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No kline data for indicator calculation", {"symbol": symbol.upper()}),
        )

    data = calculate_indicators(df, requested)
    return {
        "data": data,
        "meta": {
            "symbol": symbol.upper(),
            "period": period,
            "names": requested,
        },
    }
