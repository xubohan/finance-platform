"""Runtime system endpoints for observability and diagnostics."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, settings
from app.database import get_db
from app.services.cache_maintenance import cleanup_research_cache_tables, read_cache_maintenance_summary
from app.services.observability import runtime_observability

router = APIRouter()


def _runtime_settings(request: Request) -> Settings:
    return getattr(request.app.state, "settings", settings)


@router.get("/observability")
async def get_observability(
    route_limit: int = Query(8, ge=1, le=20),
    failing_limit: int = Query(6, ge=1, le=20),
    counter_limit: int = Query(20, ge=1, le=50),
) -> dict[str, Any]:
    """Return lightweight in-process runtime counters for the workspace."""
    return {
        "data": runtime_observability.snapshot(
            route_limit=route_limit,
            failing_limit=failing_limit,
            counter_limit=counter_limit,
        ),
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    }


@router.get("/cache-maintenance")
async def get_cache_maintenance(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return current cache-table retention and cleanup summary."""
    runtime_settings = _runtime_settings(request)
    summary = await read_cache_maintenance_summary(
        db,
        snapshot_retention_days=runtime_settings.snapshot_daily_retention_days,
    )
    return {
        "data": summary,
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "snapshot_retention_days": runtime_settings.snapshot_daily_retention_days,
        },
    }


@router.post("/cache-maintenance/cleanup")
async def cleanup_cache_maintenance(
    request: Request,
    dry_run: bool = Query(True),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Purge expired or over-retention cache rows."""
    runtime_settings = _runtime_settings(request)
    result = await cleanup_research_cache_tables(
        db,
        snapshot_retention_days=runtime_settings.snapshot_daily_retention_days,
        dry_run=dry_run,
    )
    return {
        "data": result,
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "snapshot_retention_days": runtime_settings.snapshot_daily_retention_days,
        },
    }
