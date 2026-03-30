"""Celery tasks for periodic news ingestion."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from app.config import settings
from app.database import get_task_db_session
from app.services.news_aggregator import NewsAggregator
from tasks.celery_app import celery_app


@celery_app.task(name="tasks.news_tasks.fetch_all_sources")
def fetch_all_sources() -> dict[str, object]:
    async def _run() -> dict[str, object]:
        async with get_task_db_session() as session:
            aggregator = NewsAggregator(settings)
            result = await aggregator.fetch_and_store(session, market="all", limit_per_source=10)
            return {
                "status": "completed",
                "fetched_items": result["count"],
                "inserted": result["inserted"],
                "updated": result["updated"],
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

    return asyncio.run(_run())


@celery_app.task(name="tasks.news_tasks.process_unanalyzed_news")
def process_unanalyzed_news() -> dict[str, object]:
    async def _run() -> dict[str, object]:
        async with get_task_db_session() as session:
            aggregator = NewsAggregator(settings)
            result = await aggregator.process_pending_llm(session)
            return {
                "status": "completed",
                "processed_items": result["processed"],
                "failed_items": result["failed"],
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

    return asyncio.run(_run())
