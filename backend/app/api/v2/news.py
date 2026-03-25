"""V2 news routes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.news_aggregator import NewsAggregator

router = APIRouter()
aggregator = NewsAggregator()


def _sentiment_clause(label: str) -> tuple[str, dict[str, float]]:
    if label == "positive":
        return "COALESCE(sentiment, 0) > :sentiment_threshold", {"sentiment_threshold": 0.15}
    if label == "negative":
        return "COALESCE(sentiment, 0) < :sentiment_threshold", {"sentiment_threshold": -0.15}
    if label == "neutral":
        return "COALESCE(sentiment, 0) BETWEEN :sentiment_floor AND :sentiment_ceiling", {
            "sentiment_floor": -0.15,
            "sentiment_ceiling": 0.15,
        }
    return "1=1", {}


async def _fetch_news_rows(
    db: AsyncSession,
    *,
    market: str,
    query: str | None,
    symbols: list[str],
    categories: list[str],
    sentiment: str | None,
    importance: int | None,
    start: str | None,
    end: str | None,
    offset: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int]:
    filters = ["1=1"]
    params: dict[str, Any] = {"offset": offset, "page_size": page_size}

    if market != "all":
        filters.append(":market = ANY(markets)")
        params["market"] = market
    if query:
        filters.append(
            "(title ILIKE :query OR COALESCE(content, '') ILIKE :query OR COALESCE(llm_summary, '') ILIKE :query OR COALESCE(llm_impact, '') ILIKE :query)"
        )
        params["query"] = f"%{query.strip()}%"
    if symbols:
        filters.append("symbols && :symbols")
        params["symbols"] = symbols
    if categories:
        filters.append("categories && :categories")
        params["categories"] = categories
    if importance is not None:
        filters.append("importance >= :importance")
        params["importance"] = importance
    if start:
        filters.append("published_at >= :start_date")
        params["start_date"] = start
    if end:
        filters.append("published_at <= :end_date")
        params["end_date"] = end
    if sentiment:
        clause, extra = _sentiment_clause(sentiment)
        filters.append(clause)
        params.update(extra)

    where_clause = " AND ".join(filters)
    data_query = f"""
        SELECT id, title, source, published_at, symbols, categories, markets, sentiment, importance,
               llm_summary, llm_impact, url
        FROM news_items
        WHERE {where_clause}
        ORDER BY published_at DESC, id DESC
        LIMIT :page_size OFFSET :offset
    """
    count_query = f"SELECT COUNT(*) AS total FROM news_items WHERE {where_clause}"
    rows_result = await db.execute(text(data_query), params)
    count_result = await db.execute(text(count_query), params)
    rows = [dict(row) for row in rows_result.mappings().all()]
    total = int(count_result.scalar_one() or 0)
    return rows, total


@router.get("/feed")
async def get_news_feed(
    market: str = Query("all", pattern="^(us|cn|crypto|all)$"),
    query: str | None = Query(None),
    symbols: str | None = Query(None),
    category: str | None = Query(None),
    sentiment: str | None = Query(None, pattern="^(positive|negative|neutral)$"),
    importance: int | None = Query(None, ge=1, le=5),
    start: str | None = Query(None),
    end: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if page == 1:
        probe = await db.execute(text("SELECT COUNT(*) FROM news_items"))
        if int(probe.scalar_one() or 0) == 0:
            await aggregator.fetch_and_store(db, market=market, limit_per_source=8)
    symbol_list = [item.strip().upper() for item in (symbols or "").split(",") if item.strip()]
    category_list = [item.strip().lower() for item in (category or "").split(",") if item.strip()]
    rows, total = await _fetch_news_rows(
        db,
        market=market,
        query=query.strip() if query else None,
        symbols=symbol_list,
        categories=category_list,
        sentiment=sentiment,
        importance=importance,
        start=start,
        end=end,
        offset=(page - 1) * page_size,
        page_size=page_size,
    )
    return {
        "data": rows,
        "meta": {
            "count": len(rows),
            "total": total,
            "page": page,
            "page_size": page_size,
            "sentiment_distribution": {
                "positive": sum(1 for row in rows if (row.get("sentiment") or 0) > 0.15),
                "neutral": sum(1 for row in rows if -0.15 <= (row.get("sentiment") or 0) <= 0.15),
                "negative": sum(1 for row in rows if (row.get("sentiment") or 0) < -0.15),
            },
        },
    }


@router.get("/stats")
async def get_news_stats(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN COALESCE(sentiment, 0) > 0.15 THEN 1 ELSE 0 END) AS positive_count,
                SUM(CASE WHEN COALESCE(sentiment, 0) < -0.15 THEN 1 ELSE 0 END) AS negative_count,
                SUM(CASE WHEN COALESCE(sentiment, 0) BETWEEN -0.15 AND 0.15 THEN 1 ELSE 0 END) AS neutral_count
            FROM news_items
            WHERE published_at >= NOW() - INTERVAL '7 days'
            """
        )
    )
    row = result.mappings().one()
    return {"data": dict(row), "meta": {"generated_at": datetime.now(timezone.utc).isoformat()}}


@router.get("/{symbol}/feed")
async def get_symbol_news_feed(
    symbol: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await get_news_feed(
        market="all",
        query=None,
        symbols=symbol.upper(),
        category=None,
        sentiment=None,
        importance=None,
        start=None,
        end=None,
        page=page,
        page_size=page_size,
        db=db,
    )


@router.get("/{news_id}")
async def get_news_detail(news_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            SELECT id, source, source_id, title, content, url, published_at, symbols, categories,
                   markets, sentiment, importance, llm_summary, llm_impact, llm_key_factors, processed, created_at
            FROM news_items
            WHERE id = :news_id
            """
        ),
        {"news_id": news_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "News item not found"}})
    return {"data": dict(row), "meta": {"generated_at": datetime.now(timezone.utc).isoformat()}}


@router.post("/refresh", status_code=202)
async def refresh_news(response: Response) -> dict[str, Any]:
    response.headers["X-Task-Name"] = "tasks.news_tasks.fetch_all_sources"
    try:
        from tasks.news_tasks import fetch_all_sources

        async_result = fetch_all_sources.delay()
        task_id = async_result.id
    except Exception:
        task_id = "local-refresh"
    return {
        "data": {"status": "queued", "task": "tasks.news_tasks.fetch_all_sources", "task_id": task_id},
        "meta": {"accepted_at": datetime.now(timezone.utc).isoformat()},
    }
