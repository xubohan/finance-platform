"""V2 screener routes wrapping existing v1 screener logic."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import screener as screener_v1
from app.database import get_db

router = APIRouter()


@router.get("/symbols")
async def get_screener_symbols(
    market: Literal["us", "cn"] = Query("us"),
    limit: int = Query(50, ge=10, le=300),
    force_refresh: bool = Query(True),
    allow_stale: bool = Query(False),
) -> dict[str, Any]:
    """Expose screener symbol universe through v2 path."""
    return await screener_v1.get_screener_symbols(
        market=market,
        limit=limit,
        force_refresh=force_refresh,
        allow_stale=allow_stale,
    )


@router.post("/run")
async def run_screener(
    payload: screener_v1.ScreenerRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Expose screener execution through v2 path."""
    return await screener_v1.run_screener(payload=payload, db=db)
