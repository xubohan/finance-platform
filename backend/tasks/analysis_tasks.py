"""Celery tasks for asynchronous analysis flows."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import text

from app.config import settings
from app.database import get_task_db_session
from app.schemas.analysis import EventImpactRequest
from app.services.analysis_controller import AnalysisController
from app.services.event_impact_engine import EventImpactEngine
from tasks.celery_app import celery_app


@celery_app.task(name="tasks.analysis_tasks.run_event_impact")
def run_event_impact(payload: dict[str, object]) -> dict[str, object]:
    async def _run() -> dict[str, object]:
        async with get_task_db_session() as session:
            controller = AnalysisController(settings)
            result = await controller.run_event_impact(
                db=session,
                payload=EventImpactRequest.model_validate(payload),
            )
            return result

    return asyncio.run(_run())


@celery_app.task(name="tasks.analysis_tasks.calc_pending_event_impact")
def calc_pending_event_impact() -> dict[str, object]:
    async def _run() -> dict[str, object]:
        async with get_task_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT e.id, e.title, e.event_type, e.event_date, COALESCE(e.description, e.title) AS event_text, e.symbols
                    FROM market_events e
                    WHERE NOT EXISTS (
                        SELECT 1 FROM event_impact_records r WHERE r.event_id = e.id
                    )
                    ORDER BY e.event_date DESC
                    LIMIT 20
                    """
                )
            )
            rows = result.mappings().all()
            processed = 0
            stored_records = 0
            engine = EventImpactEngine()
            for row in rows:
                stored_records += await engine.backfill_event_impacts(
                    session,
                    event_id=row["id"],
                    event_date=row["event_date"],
                    symbols=list(row["symbols"] or []),
                )
                processed += 1
            return {
                "status": "completed",
                "processed_events": processed,
                "stored_records": stored_records,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

    return asyncio.run(_run())


@celery_app.task(name="tasks.analysis_tasks.cleanup_expired_cache")
def cleanup_expired_cache() -> dict[str, object]:
    async def _run() -> dict[str, object]:
        async with get_task_db_session() as session:
            result = await session.execute(text("DELETE FROM llm_analysis_cache WHERE expires_at <= NOW()"))
            await session.commit()
            return {
                "status": "completed",
                "deleted_rows": result.rowcount or 0,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

    return asyncio.run(_run())
