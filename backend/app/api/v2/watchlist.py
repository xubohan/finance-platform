"""Watchlist APIs for the multi-asset dashboard."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.market import get_quotes
from app.database import get_db
from app.schemas.market import BatchQuoteRequest

router = APIRouter()


class WatchlistCreateRequest(BaseModel):
    """Create watchlist item request."""

    symbol: str = Field(..., min_length=1, max_length=30)
    asset_type: Literal["stock", "crypto"]
    name: str | None = Field(default=None, max_length=100)


@router.get("")
async def list_watchlist(db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    result = await db.execute(
        text(
            """
            SELECT symbol, asset_type, name, sort_order, added_at
            FROM watchlist_items
            ORDER BY sort_order ASC, added_at DESC, symbol ASC
            """
        )
    )
    rows = [dict(row) for row in result.mappings().all()]
    return {"data": rows, "meta": {"count": len(rows)}}


@router.post("")
async def add_watchlist_item(payload: WatchlistCreateRequest, db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    normalized_symbol = payload.symbol.upper().strip()
    resolved_name = payload.name
    if resolved_name is None:
        name_result = await db.execute(
            text(
                """
                SELECT name
                FROM assets
                WHERE symbol = :symbol AND asset_type = :asset_type
                LIMIT 1
                """
            ),
            {
                "symbol": normalized_symbol,
                "asset_type": payload.asset_type,
            },
        )
        name_row = name_result.mappings().first()
        resolved_name = name_row["name"] if name_row is not None else None

    insert_result = await db.execute(
        text(
            """
            INSERT INTO watchlist_items(symbol, asset_type, name, sort_order, added_at)
            VALUES (
                :symbol,
                :asset_type,
                :name,
                COALESCE((SELECT MAX(sort_order) + 1 FROM watchlist_items), 0),
                :added_at
            )
            ON CONFLICT (symbol, asset_type) DO UPDATE SET
                name = COALESCE(EXCLUDED.name, watchlist_items.name)
            RETURNING symbol, asset_type, name, sort_order, added_at
            """
        ),
        {
            "symbol": normalized_symbol,
            "asset_type": payload.asset_type,
            "name": resolved_name,
            "added_at": datetime.now(timezone.utc),
        },
    )
    await db.commit()
    row = insert_result.mappings().one()
    return {"data": dict(row), "meta": {"created": True}}


@router.delete("/{symbol}")
async def delete_watchlist_item(
    symbol: str,
    asset_type: Literal["stock", "crypto"] | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, object]:
    normalized_symbol = symbol.upper().strip()
    clauses = ["symbol = :symbol"]
    params: dict[str, object] = {"symbol": normalized_symbol}
    if asset_type is not None:
        clauses.append("asset_type = :asset_type")
        params["asset_type"] = asset_type
    stmt = f"""
        DELETE FROM watchlist_items
        WHERE {' AND '.join(clauses)}
        RETURNING symbol, asset_type
    """
    result = await db.execute(text(stmt), params)
    deleted = result.mappings().all()
    await db.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Watchlist item not found"}})
    return {"data": {"deleted": [dict(row) for row in deleted]}, "meta": {"count": len(deleted)}}


@router.get("/quotes")
async def get_watchlist_quotes(db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    result = await db.execute(
        text(
            """
            SELECT symbol, asset_type, name
            FROM watchlist_items
            ORDER BY sort_order ASC, added_at DESC, symbol ASC
            """
        )
    )
    rows = result.mappings().all()
    if not rows:
        return {"data": [], "meta": {"count": 0}}
    quote_payload = BatchQuoteRequest(symbols=[row["symbol"] for row in rows])
    quote_result = await get_quotes(quote_payload, db=db)
    quote_map = {row["symbol"]: row for row in quote_result.get("data", [])}
    data = []
    sources: set[str] = set()
    providers: set[str] = set()
    stale_count = 0
    failed_count = 0
    latest_as_of: str | None = None
    for row in rows:
        merged = dict(row)
        merged.update(quote_map.get(row["symbol"], {}))
        source = merged.get("source")
        provider = merged.get("provider")
        as_of = merged.get("as_of")
        if isinstance(source, str) and source:
            sources.add(source)
        if isinstance(provider, str) and provider:
            providers.add(provider)
        if merged.get("stale") is True:
            stale_count += 1
        if merged.get("error"):
            failed_count += 1
        if isinstance(as_of, str) and (latest_as_of is None or as_of > latest_as_of):
            latest_as_of = as_of
        data.append(merged)
    quote_meta = dict(quote_result.get("meta", {}))
    quote_meta.update(
        {
            "count": len(data),
            "sources": sorted(sources),
            "providers": sorted(providers),
            "stale_count": stale_count,
            "fresh_count": len(data) - stale_count - failed_count,
            "failed_count": failed_count,
            "as_of": latest_as_of,
        }
    )
    return {"data": data, "meta": quote_meta}
