"""Factor-scoring API routes."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import pandas as pd

from app.services.factor_engine import score_factors
from app.services.openbb_adapter import fetch_stock_snapshot_with_meta, fetch_stock_universe_total_with_meta

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
    market: Literal["us", "cn"] = "us"
    symbol_limit: int = Field(20000, ge=50, le=20000)
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=50, le=50)
    force_refresh: bool = True
    allow_stale: bool = False


def _error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details or {}},
        "request_id": "",
    }


def _snapshot_universe(
    market: Literal["us", "cn"],
    symbol_limit: int,
    *,
    force_refresh: bool,
    allow_stale: bool,
) -> tuple[pd.DataFrame, int, dict[str, Any]]:
    """Build dynamic factor universe from latest market snapshot."""
    rows, snapshot_meta = fetch_stock_snapshot_with_meta(
        market=market,
        limit=symbol_limit,
        force_refresh=force_refresh,
        allow_stale=allow_stale,
    )
    if not rows:
        return pd.DataFrame(), 0, snapshot_meta

    normalized: list[dict[str, Any]] = []
    seen_symbols: set[str] = set()

    for row in rows:
        symbol = str(row.get("symbol", "")).upper()
        if not symbol or symbol in seen_symbols:
            continue

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
                "symbol": symbol,
                "name": row.get("name") or symbol,
                "pe_ttm": float(pe),
                "profit_yoy": float(growth),
                # Snapshot provides current change pct, used as short-term momentum proxy.
                "momentum_20d": float(momentum),
                "roe": float(roe),
            }
        )
        seen_symbols.add(symbol)

    return pd.DataFrame(normalized), len(rows), snapshot_meta


@router.post("/score")
async def factors_score(payload: FactorScoreRequest) -> dict[str, Any]:
    """Calculate weighted stock factor ranking."""
    weights = payload.weights.model_dump()

    if round(sum(weights.values()), 6) != 100.0:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_WEIGHTS", "weights must sum to 100", {"weights": weights}),
        )

    df, snapshot_count, snapshot_meta = _snapshot_universe(
        payload.market,
        payload.symbol_limit,
        force_refresh=payload.force_refresh,
        allow_stale=payload.allow_stale,
    )
    if snapshot_count == 0:
        raise HTTPException(
            status_code=502,
            detail=_error(
                "UPSTREAM_UNAVAILABLE",
                "Failed to fetch latest stock snapshot for factor scoring",
                {"market": payload.market},
            ),
        )

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No usable live stock universe for factor scoring", {"market": payload.market}),
        )

    ranked_all = score_factors(df, weights=weights, top_n=len(df))
    total_items = len(ranked_all)
    total_pages = max(1, (total_items + payload.page_size - 1) // payload.page_size)
    page = min(payload.page, total_pages)
    start_idx = (page - 1) * payload.page_size
    end_idx = start_idx + payload.page_size
    data = ranked_all.iloc[start_idx:end_idx].to_dict("records")

    total_available, total_meta = fetch_stock_universe_total_with_meta(
        payload.market,
        force_refresh=payload.force_refresh,
        allow_stale=payload.allow_stale,
    )

    return {
        "data": data,
        "meta": {
            "count": len(data),
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "page_size": payload.page_size,
            "market": payload.market,
            "symbols_fetched": snapshot_count,
            "total_available": total_available,
            "source": snapshot_meta.get("source"),
            "stale": bool(snapshot_meta.get("stale")) or bool(total_meta.get("stale")),
            "as_of": snapshot_meta.get("as_of"),
            "cache_age_sec": snapshot_meta.get("cache_age_sec"),
            "refresh_in_progress": False,
        },
    }
