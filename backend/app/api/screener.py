"""Stock screener API routes."""

from __future__ import annotations

from datetime import date
import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.openbb_adapter import (
    fetch_stock_snapshot_with_meta,
    fetch_stock_symbols_with_meta,
    fetch_stock_universe_total_with_meta,
)

router = APIRouter()
MAX_ASSET_NAME_LEN = 100

_US_NAME_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("Public Limited Company", "PLC"),
    ("American Depositary Shares", "ADS"),
    ("Depositary Shares", "DS"),
    ("Common Stock", "CS"),
    ("Ordinary Shares", "Ord Shs"),
    ("Preferred Stock", "Pfd"),
    ("Non-Cumulative", "Non-Cum"),
    ("Perpetual", "Perp"),
    ("Corporation", "Corp"),
    ("Incorporated", "Inc"),
    ("Company", "Co"),
    ("Limited", "Ltd"),
    ("Representing", "Rep."),
    ("Interest", "Int."),
    ("Class A", "Cl A"),
    ("Class B", "Cl B"),
    ("Class C", "Cl C"),
)


class ScreenerRequest(BaseModel):
    """Stock screener request schema."""

    min_pe: float | None = None
    max_pe: float | None = None
    min_roe: float | None = None
    min_profit_yoy: float | None = None
    market: Literal["us", "cn"] = "us"
    symbol_limit: int = Field(20000, ge=50, le=20000)
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=50, le=50)
    force_refresh: bool = False
    allow_stale: bool = True


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


def _to_float(value: Any) -> float | None:
    """Convert numeric-like value to float."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_ws(text: str) -> str:
    """Collapse repeated whitespace to keep names compact."""
    return re.sub(r"\s+", " ", text).strip()


def _abbreviate_us_name(name: str, symbol: str) -> str:
    """Compact long US security names to avoid DB length overflow."""
    short = _normalize_ws(name)
    for src, dst in _US_NAME_REPLACEMENTS:
        short = short.replace(src, dst)
    short = _normalize_ws(short)

    if len(short) <= MAX_ASSET_NAME_LEN:
        return short

    primary = short.split(",", 1)[0].strip()
    if primary and len(primary) <= MAX_ASSET_NAME_LEN:
        return primary

    primary = short.split("(", 1)[0].strip()
    if primary and len(primary) <= MAX_ASSET_NAME_LEN:
        return primary

    if len(symbol) + 1 < MAX_ASSET_NAME_LEN:
        keep = MAX_ASSET_NAME_LEN - len(symbol) - 1
        return f"{symbol} {short[:keep].rstrip()}"
    return short[:MAX_ASSET_NAME_LEN].rstrip()


def _compact_asset_name(name: Any, symbol: str, market: str) -> str:
    """Normalize upstream name and apply US abbreviation with length guard."""
    normalized = _normalize_ws(str(name or symbol)) or symbol
    if market.upper() == "US":
        normalized = _abbreviate_us_name(normalized, symbol)
    if len(normalized) > MAX_ASSET_NAME_LEN:
        normalized = normalized[:MAX_ASSET_NAME_LEN].rstrip()
    return normalized or symbol[:MAX_ASSET_NAME_LEN]


def _build_live_rows(rows: list[dict[str, Any]], payload: ScreenerRequest) -> list[dict[str, Any]]:
    """Filter live snapshot rows by screener conditions."""
    out: list[dict[str, Any]] = []

    for row in rows:
        symbol = str(row.get("symbol", "")).upper()
        market = str(row.get("market", payload.market)).upper()
        pe_ttm = _to_float(row.get("pe_ttm"))
        roe = _to_float(row.get("roe"))
        profit_yoy = _to_float(row.get("profit_yoy"))

        if pe_ttm is None and roe is None and profit_yoy is None:
            continue
        if payload.min_pe is not None and (pe_ttm is None or pe_ttm < payload.min_pe):
            continue
        if payload.max_pe is not None and (pe_ttm is None or pe_ttm > payload.max_pe):
            continue
        if payload.min_roe is not None and (roe is None or roe < payload.min_roe):
            continue
        if payload.min_profit_yoy is not None and (profit_yoy is None or profit_yoy < payload.min_profit_yoy):
            continue

        out.append(
            {
                "symbol": symbol,
                "name": _compact_asset_name(row.get("name"), symbol, market),
                "market": market,
                "pe_ttm": pe_ttm,
                "roe": roe,
                "profit_yoy": profit_yoy,
            }
        )

    out.sort(key=lambda r: (r["roe"] is None, -(r["roe"] or 0)))
    return out


async def _upsert_latest_fundamentals(db: AsyncSession, rows: list[dict[str, Any]]) -> dict[str, int]:
    """Upsert latest snapshot rows into DB for downstream reuse."""
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
        [
            {
                "symbol": str(r["symbol"]).upper(),
                "name": _compact_asset_name(r.get("name"), str(r["symbol"]).upper(), str(r["market"]).upper()),
                "market": str(r["market"]).upper(),
            }
            for r in usable
        ],
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
    market: Literal["us", "cn"] = Query("us"),
    limit: int = Query(50, ge=10, le=300),
    force_refresh: bool = Query(False),
    allow_stale: bool = Query(True),
) -> dict[str, Any]:
    """Fetch latest stock symbol list by market (US / CN)."""
    rows, symbol_meta = fetch_stock_symbols_with_meta(
        market=market,
        limit=limit,
        force_refresh=force_refresh,
        allow_stale=allow_stale,
    )
    total_available, total_meta = fetch_stock_universe_total_with_meta(
        market=market,
        force_refresh=force_refresh,
        allow_stale=allow_stale,
    )
    if not rows and total_available == 0:
        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest stock symbol universe", {"market": market}),
        )

    return {
        "data": rows,
        "meta": {
            "count": len(rows),
            "market": market,
            "total_available": total_available,
            "source": symbol_meta.get("source"),
            "stale": bool(symbol_meta.get("stale")) or bool(total_meta.get("stale")),
            "as_of": symbol_meta.get("as_of") or total_meta.get("as_of"),
            "cache_age_sec": symbol_meta.get("cache_age_sec"),
            "refresh_in_progress": False,
        },
    }


@router.post("/run")
async def run_screener(payload: ScreenerRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Run stock screener from live snapshot feed only."""
    snapshot_rows, snapshot_meta = fetch_stock_snapshot_with_meta(
        market=payload.market,
        limit=payload.symbol_limit,
        force_refresh=payload.force_refresh,
        allow_stale=payload.allow_stale,
    )
    if not snapshot_rows:
        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest stock snapshot", {"market": payload.market}),
        )

    refresh_stats = await _upsert_latest_fundamentals(db, snapshot_rows)
    filtered_rows = _build_live_rows(snapshot_rows, payload)
    total_items = len(filtered_rows)
    total_pages = max(1, (total_items + payload.page_size - 1) // payload.page_size)
    page = min(payload.page, total_pages)
    start_idx = (page - 1) * payload.page_size
    end_idx = start_idx + payload.page_size
    rows = filtered_rows[start_idx:end_idx]
    total_available, total_meta = fetch_stock_universe_total_with_meta(
        market=payload.market,
        force_refresh=payload.force_refresh,
        allow_stale=payload.allow_stale,
    )

    return {
        "data": rows,
        "meta": {
            "count": len(rows),
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "page_size": payload.page_size,
            "market": payload.market,
            "refresh_latest": True,
            "symbols_fetched": refresh_stats["symbols"],
            "fundamentals_upserted": refresh_stats["fundamentals"],
            "total_available": total_available,
            "source": snapshot_meta.get("source"),
            "stale": bool(snapshot_meta.get("stale")) or bool(total_meta.get("stale")),
            "as_of": snapshot_meta.get("as_of"),
            "cache_age_sec": snapshot_meta.get("cache_age_sec"),
            "refresh_in_progress": False,
        },
    }
