"""V2 event routes."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.events import EventSearchRequest
from app.services.event_impact_engine import EventImpactEngine
from tasks.celery_app import celery_app

router = APIRouter()
impact_engine = EventImpactEngine()
logger = logging.getLogger(__name__)


def _rows(result) -> list[dict[str, Any]]:
    return [dict(row) for row in result.mappings().all()]


def _normalize_event_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)
    return None


def _event_as_of(rows: list[dict[str, Any]]) -> str | None:
    latest = max(
        (
            _normalize_event_timestamp(row.get("event_time"))
            or _normalize_event_timestamp(row.get("event_date"))
            or _normalize_event_timestamp(row.get("created_at"))
            for row in rows
        ),
        default=None,
        key=lambda item: item or datetime.min.replace(tzinfo=timezone.utc),
    )
    return latest.isoformat() if latest is not None else None


def _persisted_meta(*, as_of: str | None, **extra: Any) -> dict[str, Any]:
    stale = True
    if as_of:
        parsed = _normalize_event_timestamp(as_of)
        if parsed is not None:
            stale = (datetime.now(timezone.utc) - parsed) > timedelta(hours=24)
    return {
        "source": "persisted",
        "stale": stale,
        "as_of": as_of,
        **extra,
    }


def _impact_as_of(rows: list[dict[str, Any]]) -> str | None:
    latest = max(
        (_normalize_event_timestamp(row.get("calculated_at")) for row in rows),
        default=None,
        key=lambda item: item or datetime.min.replace(tzinfo=timezone.utc),
    )
    return latest.isoformat() if latest is not None else None


@router.get("/calendar")
async def get_event_calendar(
    start: date | None = Query(None),
    end: date | None = Query(None),
    market: str | None = Query(None),
    event_type: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    filters = ["1=1"]
    params: dict[str, Any] = {}
    if start:
        filters.append("event_date >= :start_date")
        params["start_date"] = start
    if end:
        filters.append("event_date <= :end_date")
        params["end_date"] = end
    if event_type:
        filters.append("event_type = :event_type")
        params["event_type"] = event_type
    if market and market != "all":
        filters.append(":market = ANY(markets)")
        params["market"] = market

    result = await db.execute(
        text(
            f"""
            SELECT id, title, event_type, event_date, event_time, symbols, markets, description, importance, source, source_url
            FROM market_events
            WHERE {' AND '.join(filters)}
            ORDER BY event_date ASC, importance DESC
            LIMIT 300
            """
        ),
        params,
    )
    rows = _rows(result)
    return {
        "data": rows,
        "meta": _persisted_meta(
            as_of=_event_as_of(rows),
            count=len(rows),
            generated_at=datetime.now(timezone.utc).isoformat(),
            read_only=True,
            ingest_recommended=len(rows) == 0,
            refresh_supported=True,
            refresh_endpoint="/api/v2/events/refresh",
        ),
    }


@router.get("/history")
async def get_event_history(
    event_type: str | None = Query(None),
    symbol: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    filters = ["1=1"]
    params: dict[str, Any] = {"limit": limit}
    if event_type:
        filters.append("event_type = :event_type")
        params["event_type"] = event_type
    if symbol:
        filters.append(":symbol = ANY(symbols)")
        params["symbol"] = symbol.upper()
    result = await db.execute(
        text(
            f"""
            SELECT id, title, event_type, event_date, event_time, symbols, markets, description, importance, source, source_url
            FROM market_events
            WHERE {' AND '.join(filters)}
            ORDER BY event_date DESC, importance DESC
            LIMIT :limit
            """
        ),
        params,
    )
    rows = _rows(result)
    return {
        "data": rows,
        "meta": _persisted_meta(
            as_of=_event_as_of(rows),
            count=len(rows),
            generated_at=datetime.now(timezone.utc).isoformat(),
            read_only=True,
            ingest_recommended=len(rows) == 0,
            refresh_supported=True,
            refresh_endpoint="/api/v2/events/refresh",
        ),
    }


@router.post("/refresh", status_code=202)
async def refresh_events(response: Response) -> dict[str, Any]:
    response.headers["X-Task-Name"] = "tasks.news_tasks.fetch_all_sources"
    try:
        from tasks.news_tasks import fetch_all_sources
    except Exception as exc:  # pragma: no cover - import path depends on runtime env
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "TASK_IMPORT_FAILED", "message": f"Failed to load event refresh task: {exc}"}},
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
            logger.warning("event refresh celery dispatch failed: %s", exc)
            raise HTTPException(
                status_code=503,
                detail={"error": {"code": "TASK_DISPATCH_FAILED", "message": f"Failed to dispatch event refresh task: {exc}"}},
            ) from exc

    raise HTTPException(
        status_code=503,
        detail={"error": {"code": "TASK_DISPATCH_UNAVAILABLE", "message": "Event refresh requires a running task queue"}},
    )


@router.get("/tasks/{task_id}")
async def get_event_task(task_id: str) -> dict[str, Any]:
    task = AsyncResult(task_id, app=celery_app)
    state = str(task.state).lower()
    status = (
        "queued"
        if state in {"pending", "received"}
        else "running"
        if state in {"started", "retry"}
        else "completed"
        if state == "success"
        else "failed"
        if state in {"failure", "revoked"}
        else state
    )
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


@router.get("/{event_id}")
async def get_event_detail(event_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            SELECT id, title, event_type, event_date, event_time, symbols, markets, description, importance, source, source_url, created_at
            FROM market_events
            WHERE id = :event_id
            """
        ),
        {"event_id": event_id},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Event not found"}})
    payload = dict(row)
    return {
        "data": payload,
        "meta": _persisted_meta(
            as_of=_event_as_of([payload]),
            generated_at=datetime.now(timezone.utc).isoformat(),
            read_only=True,
            ingest_recommended=False,
            refresh_supported=True,
            refresh_endpoint="/api/v2/events/refresh",
            backfill_endpoint=f"/api/v2/events/{event_id}/impact/backfill",
        ),
    }


@router.get("/{event_id}/impact")
async def get_event_impact(event_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    event_result = await db.execute(
        text("SELECT id, title, event_date FROM market_events WHERE id = :event_id"),
        {"event_id": event_id},
    )
    event_row = event_result.mappings().first()
    if event_row is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Event not found"}})
    impact_result = await db.execute(
        text(
            """
            SELECT symbol, asset_type, t_minus_5d_ret, t_minus_1d_ret, t_plus_1d_ret, t_plus_3d_ret,
                   t_plus_5d_ret, t_plus_20d_ret, vol_ratio_1d, max_drawdown, calculated_at
            FROM event_impact_records
            WHERE event_id = :event_id
            ORDER BY symbol ASC
            """
        ),
        {"event_id": event_id},
    )
    impacts = _rows(impact_result)
    as_of = _impact_as_of(impacts)
    stale = True
    if as_of:
        parsed = _normalize_event_timestamp(as_of)
        if parsed is not None:
            stale = (datetime.now(timezone.utc) - parsed) > timedelta(days=3)
    return {
        "data": {
            "event_id": event_row["id"],
            "event_title": event_row["title"],
            "event_date": event_row["event_date"],
            "impact_by_symbol": impacts,
        },
        "meta": {
            "source": "persisted",
            "as_of": as_of,
            "stale": stale,
            "read_only": True,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "backfill_endpoint": f"/api/v2/events/{event_id}/impact/backfill",
            "refresh_supported": True,
        },
    }


@router.post("/{event_id}/impact/backfill", status_code=202)
async def backfill_event_impact(event_id: int, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    event_result = await db.execute(
        text("SELECT id, event_date, symbols FROM market_events WHERE id = :event_id"),
        {"event_id": event_id},
    )
    event_row = event_result.mappings().first()
    if event_row is None:
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Event not found"}})

    symbols = list(event_row.get("symbols") or [])
    inserted = await impact_engine.backfill_event_impacts(
        db,
        event_id=event_id,
        event_date=event_row["event_date"],
        symbols=symbols,
    )
    return {
        "data": {
            "event_id": event_id,
            "status": "accepted",
            "symbols": symbols,
            "inserted_records": inserted,
        },
        "meta": {
            "execution_mode": "sync-write",
            "accepted_at": datetime.now(timezone.utc).isoformat(),
        },
    }


@router.post("/search")
async def search_events(payload: EventSearchRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    filters = ["(title ILIKE :query OR COALESCE(description, '') ILIKE :query)"]
    params: dict[str, Any] = {"query": f"%{payload.query.strip()}%"}
    if payload.event_type:
        filters.append("event_type = :event_type")
        params["event_type"] = payload.event_type
    if payload.date_range:
        if len(payload.date_range) >= 1:
            filters.append("event_date >= :start_date")
            params["start_date"] = payload.date_range[0]
        if len(payload.date_range) >= 2:
            filters.append("event_date <= :end_date")
            params["end_date"] = payload.date_range[1]
    result = await db.execute(
        text(
            f"""
            SELECT id, title, event_type, event_date, symbols, markets, description, importance
            FROM market_events
            WHERE {' AND '.join(filters)}
            ORDER BY event_date DESC, importance DESC
            LIMIT 50
            """
        ),
        params,
    )
    rows = _rows(result)
    return {
        "data": rows,
        "meta": _persisted_meta(
            as_of=_event_as_of(rows),
            count=len(rows),
            generated_at=datetime.now(timezone.utc).isoformat(),
            read_only=True,
            ingest_recommended=len(rows) == 0,
            refresh_supported=False,
        ),
    }
