"""V2 news routes."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
import logging
from typing import Any

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.news import NewsFeedQuery
from tasks.celery_app import celery_app

router = APIRouter()
logger = logging.getLogger(__name__)


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


def _parse_csv_tokens(value: str | None) -> list[str]:
    return [item.strip().lower() for item in (value or "").split(",") if item.strip()]


def _parse_symbol_tokens(value: str | None) -> list[str]:
    return [item.strip().upper() for item in (value or "").split(",") if item.strip()]


def _normalize_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    return None


def _parse_filter_datetime(value: str | None, *, label: str, end_of_day: bool = False) -> tuple[datetime | None, bool]:
    if not value:
        return None, False
    if "T" not in value and " " not in value:
        try:
            parsed_date = date.fromisoformat(value)
        except ValueError as exc:  # pragma: no cover - defensive branch
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "INVALID_DATE_FILTER", "message": f"{label} must be ISO date or datetime"}},
            ) from exc
        if end_of_day:
            parsed_date += timedelta(days=1)
        return datetime.combine(parsed_date, time.min, tzinfo=timezone.utc), end_of_day
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "INVALID_DATE_FILTER", "message": f"{label} must be ISO date or datetime"}},
        )
    normalized = parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    return normalized, False


def _latest_news_as_of(rows: list[dict[str, Any]]) -> str | None:
    latest = max(
        (_normalize_timestamp(row.get("published_at")) for row in rows),
        default=None,
        key=lambda item: item or datetime.min.replace(tzinfo=timezone.utc),
    )
    return latest.isoformat() if latest is not None else None


def _persisted_meta(*, as_of: str | None, **extra: Any) -> dict[str, Any]:
    stale = True
    if as_of:
        parsed = _normalize_timestamp(as_of)
        if parsed is not None:
            stale = (datetime.now(timezone.utc) - parsed) > timedelta(hours=2)
    return {
        "source": "persisted",
        "stale": stale,
        "as_of": as_of,
        **extra,
    }


async def _fetch_news_rows(
    db: AsyncSession,
    *,
    market: str,
    markets: list[str],
    query: str | None,
    symbols: list[str],
    categories: list[str],
    sentiment: str | None,
    sentiment_min: float | None,
    sentiment_max: float | None,
    importance: int | None,
    start: datetime | None,
    end: datetime | None,
    end_is_exclusive: bool,
    offset: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], int, dict[str, int]]:
    filters = ["1=1"]
    params: dict[str, Any] = {"offset": offset, "page_size": page_size}

    if markets:
        filters.append("markets && :markets")
        params["markets"] = markets
    elif market != "all":
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
        filters.append("published_at < :end_date" if end_is_exclusive else "published_at <= :end_date")
        params["end_date"] = end
    if sentiment:
        clause, extra = _sentiment_clause(sentiment)
        filters.append(clause)
        params.update(extra)
    if sentiment_min is not None:
        filters.append("COALESCE(sentiment, 0) >= :sentiment_min_value")
        params["sentiment_min_value"] = sentiment_min
    if sentiment_max is not None:
        filters.append("COALESCE(sentiment, 0) <= :sentiment_max_value")
        params["sentiment_max_value"] = sentiment_max

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
    distribution_query = f"""
        SELECT
            SUM(CASE WHEN COALESCE(sentiment, 0) > 0.15 THEN 1 ELSE 0 END) AS positive,
            SUM(CASE WHEN COALESCE(sentiment, 0) BETWEEN -0.15 AND 0.15 THEN 1 ELSE 0 END) AS neutral,
            SUM(CASE WHEN COALESCE(sentiment, 0) < -0.15 THEN 1 ELSE 0 END) AS negative
        FROM news_items
        WHERE {where_clause}
    """
    rows_result = await db.execute(text(data_query), params)
    count_result = await db.execute(text(count_query), params)
    distribution_result = await db.execute(text(distribution_query), params)
    rows = [dict(row) for row in rows_result.mappings().all()]
    total = int(count_result.scalar_one() or 0)
    distribution_row = distribution_result.mappings().first() or {}
    distribution = {
        "positive": int(distribution_row.get("positive") or 0),
        "neutral": int(distribution_row.get("neutral") or 0),
        "negative": int(distribution_row.get("negative") or 0),
    }
    return rows, total, distribution


@router.get("/feed")
async def get_news_feed(
    market: str = Query("all", pattern="^(us|cn|crypto|all)$"),
    markets: str | None = Query(None),
    query: str | None = Query(None),
    symbols: str | None = Query(None),
    category: str | None = Query(None),
    sentiment: str | None = Query(None, pattern="^(positive|negative|neutral)$"),
    sentiment_min: float | None = Query(None, ge=-1, le=1),
    sentiment_max: float | None = Query(None, ge=-1, le=1),
    importance: int | None = Query(None, ge=1, le=5),
    start: str | None = Query(None),
    end: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    try:
        params = NewsFeedQuery(
            market=market,
            markets=markets,
            query=query,
            symbols=symbols,
            category=category,
            sentiment=sentiment,
            sentiment_min=sentiment_min,
            sentiment_max=sentiment_max,
            importance=importance,
            start=start,
            end=end,
            page=page,
            page_size=page_size,
        )
    except ValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": {"code": "INVALID_NEWS_FILTERS", "message": str(exc)}},
        ) from exc

    market_list = [item for item in _parse_csv_tokens(params.markets) if item in {"us", "cn", "crypto"}]
    symbol_list = [item.strip().upper() for item in (params.symbols or "").split(",") if item.strip()]
    category_list = _parse_csv_tokens(params.category)
    start_filter, _ = _parse_filter_datetime(params.start, label="start")
    end_filter, end_is_exclusive = _parse_filter_datetime(params.end, label="end", end_of_day=True)
    rows, total, distribution = await _fetch_news_rows(
        db,
        market=params.market,
        markets=market_list,
        query=params.query.strip() if params.query else None,
        symbols=symbol_list,
        categories=category_list,
        sentiment=params.sentiment,
        sentiment_min=params.sentiment_min,
        sentiment_max=params.sentiment_max,
        importance=params.importance,
        start=start_filter,
        end=end_filter,
        end_is_exclusive=end_is_exclusive,
        offset=(params.page - 1) * params.page_size,
        page_size=params.page_size,
    )
    return {
        "data": rows,
        "meta": _persisted_meta(
            as_of=_latest_news_as_of(rows),
            count=len(rows),
            total=total,
            page=params.page,
            page_size=params.page_size,
            market=params.market,
            markets=market_list,
            sentiment_distribution=distribution,
            read_only=True,
            ingest_recommended=total == 0,
            refresh_supported=True,
            refresh_endpoint="/api/v2/news/refresh",
        ),
    }


@router.get("/stats")
async def get_news_stats(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            SELECT
                COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '7 days') AS week_total,
                SUM(CASE WHEN published_at >= NOW() - INTERVAL '7 days' AND COALESCE(sentiment, 0) > 0.15 THEN 1 ELSE 0 END) AS week_positive_count,
                SUM(CASE WHEN published_at >= NOW() - INTERVAL '7 days' AND COALESCE(sentiment, 0) < -0.15 THEN 1 ELSE 0 END) AS week_negative_count,
                SUM(CASE WHEN published_at >= NOW() - INTERVAL '7 days' AND COALESCE(sentiment, 0) BETWEEN -0.15 AND 0.15 THEN 1 ELSE 0 END) AS week_neutral_count,
                COUNT(*) FILTER (WHERE published_at >= date_trunc('day', NOW())) AS today_total,
                SUM(CASE WHEN published_at >= date_trunc('day', NOW()) AND COALESCE(sentiment, 0) > 0.15 THEN 1 ELSE 0 END) AS today_positive_count,
                SUM(CASE WHEN published_at >= date_trunc('day', NOW()) AND COALESCE(sentiment, 0) < -0.15 THEN 1 ELSE 0 END) AS today_negative_count,
                SUM(CASE WHEN published_at >= date_trunc('day', NOW()) AND COALESCE(sentiment, 0) BETWEEN -0.15 AND 0.15 THEN 1 ELSE 0 END) AS today_neutral_count
            FROM news_items
            """
        )
    )
    row = result.mappings().one()
    week = {
        "total": int(row.get("week_total") or 0),
        "positive_count": int(row.get("week_positive_count") or 0),
        "negative_count": int(row.get("week_negative_count") or 0),
        "neutral_count": int(row.get("week_neutral_count") or 0),
    }
    today = {
        "total": int(row.get("today_total") or 0),
        "positive_count": int(row.get("today_positive_count") or 0),
        "negative_count": int(row.get("today_negative_count") or 0),
        "neutral_count": int(row.get("today_neutral_count") or 0),
    }
    return {
        "data": {
            **week,
            "today": today,
            "week": week,
        },
        "meta": _persisted_meta(
            as_of=None,
            generated_at=datetime.now(timezone.utc).isoformat(),
            refresh_supported=True,
            refresh_endpoint="/api/v2/news/refresh",
        ),
    }


@router.get("/{symbol}/feed")
async def get_symbol_news_feed(
    symbol: str,
    market: str = Query("all", pattern="^(us|cn|crypto|all)$"),
    markets: str | None = Query(None),
    query: str | None = Query(None),
    symbols: str | None = Query(None),
    category: str | None = Query(None),
    sentiment: str | None = Query(None, pattern="^(positive|negative|neutral)$"),
    sentiment_min: float | None = Query(None, ge=-1, le=1),
    sentiment_max: float | None = Query(None, ge=-1, le=1),
    importance: int | None = Query(None, ge=1, le=5),
    start: str | None = Query(None),
    end: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    symbol_tokens = [symbol.upper(), *_parse_symbol_tokens(symbols)]
    unique_symbols = list(dict.fromkeys(symbol_tokens))
    return await get_news_feed(
        market=market,
        markets=markets,
        query=query,
        symbols=",".join(unique_symbols),
        category=category,
        sentiment=sentiment,
        sentiment_min=sentiment_min,
        sentiment_max=sentiment_max,
        importance=importance,
        start=start,
        end=end,
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
    payload = dict(row)
    return {
        "data": payload,
        "meta": _persisted_meta(
            as_of=_latest_news_as_of([payload]),
            generated_at=datetime.now(timezone.utc).isoformat(),
            refresh_supported=True,
            refresh_endpoint="/api/v2/news/refresh",
        ),
    }


@router.post("/refresh", status_code=202)
async def refresh_news(response: Response) -> dict[str, Any]:
    response.headers["X-Task-Name"] = "tasks.news_tasks.fetch_all_sources"
    try:
        from tasks.news_tasks import fetch_all_sources
    except Exception as exc:  # pragma: no cover - import path depends on runtime env
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "TASK_IMPORT_FAILED", "message": f"Failed to load news refresh task: {exc}"}},
        ) from exc

    delay = getattr(fetch_all_sources, "delay", None)
    if callable(delay):
        try:
            async_result = delay()
            return {
                "data": {"status": "queued", "task": "tasks.news_tasks.fetch_all_sources", "task_id": async_result.id},
                "meta": {
                    "accepted_at": datetime.now(timezone.utc).isoformat(),
                    "execution_mode": "celery",
                },
            }
        except Exception as exc:  # pragma: no cover - broker/runtime dependent
            logger.warning("news refresh celery dispatch failed: %s", exc)
            raise HTTPException(
                status_code=503,
                detail={"error": {"code": "TASK_DISPATCH_FAILED", "message": f"Failed to dispatch news refresh task: {exc}"}},
            ) from exc

    raise HTTPException(
        status_code=503,
        detail={"error": {"code": "TASK_DISPATCH_UNAVAILABLE", "message": "News refresh requires a running task queue"}},
    )


@router.get("/tasks/{task_id}")
async def get_news_task(task_id: str) -> dict[str, Any]:
    task = AsyncResult(task_id, app=celery_app)
    state = str(task.state).lower()
    status = "queued" if state in {"pending", "received"} else "running" if state in {"started", "retry"} else "completed" if state == "success" else "failed" if state in {"failure", "revoked"} else state
    payload: dict[str, Any] = {
        "data": {
            "task_id": task_id,
            "status": status,
        },
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "execution_mode": "celery",
            "task_name": "tasks.news_tasks.fetch_all_sources",
        },
    }
    if status == "completed":
        payload["data"]["result_payload"] = task.result if isinstance(task.result, dict) else {"data": task.result}
    if status == "failed":
        payload["data"]["error"] = str(task.result)
    return payload
