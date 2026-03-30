"""V2 system and runtime introspection APIs."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import system as system_v1
from app.config import Settings, settings
from app.database import get_db
from app.services.llm_service import LLMService
from app.services.openbb_adapter import fetch_crypto_realtime_price, fetch_stock_realtime_quote
from app.services.provider_health import run_provider_health_check

router = APIRouter()
_data_status_cache: dict[str, Any] = {"expires_at": None, "payload": None}
_data_status_lock = asyncio.Lock()


def _runtime_settings(request: Request) -> Settings:
    return getattr(request.app.state, "settings", settings)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _cache_enabled(cfg: Settings) -> bool:
    return cfg.provider_health_cache_ttl_sec > 0


def _cache_expires_at(cfg: Settings, generated_at: datetime) -> datetime:
    return generated_at.replace(microsecond=0) + timedelta(seconds=cfg.provider_health_cache_ttl_sec)


def _read_cached_data_status(now: datetime) -> dict[str, Any] | None:
    payload = _data_status_cache.get("payload")
    expires_at = _data_status_cache.get("expires_at")
    if not payload or not isinstance(expires_at, datetime) or now >= expires_at:
        return None
    cached = deepcopy(payload)
    cached.setdefault("meta", {})
    cached["meta"]["served_from_cache"] = True
    return cached


def _clear_data_status_cache() -> None:
    _data_status_cache["expires_at"] = None
    _data_status_cache["payload"] = None


def _normalize_iso_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        normalized = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return normalized.astimezone(timezone.utc).isoformat()
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    return str(value)


def read_stock_quote_sample() -> dict[str, Any]:
    payload = fetch_stock_realtime_quote("AAPL")
    if not payload:
        return {
            "symbol": "AAPL",
            "asset_type": "stock",
            "status": "error",
            "error": "sample quote unavailable",
            "source": None,
            "provider": None,
            "fetch_source": None,
            "stale": None,
            "as_of": None,
            "price": None,
            "change_pct_24h": None,
        }
    return {
        "symbol": "AAPL",
        "asset_type": "stock",
        "status": "ok",
        "error": None,
        "source": payload.get("source"),
        "provider": payload.get("provider"),
        "fetch_source": payload.get("fetch_source"),
        "stale": payload.get("stale"),
        "as_of": payload.get("as_of"),
        "price": payload.get("price"),
        "change_pct_24h": payload.get("change_pct_24h"),
    }


def read_crypto_quote_sample() -> dict[str, Any]:
    payload = fetch_crypto_realtime_price(["BTC"]).get("BTC", {})
    if not payload:
        return {
            "symbol": "BTC",
            "asset_type": "crypto",
            "status": "error",
            "error": "sample quote unavailable",
            "source": None,
            "provider": None,
            "fetch_source": None,
            "stale": None,
            "as_of": None,
            "price": None,
            "change_pct_24h": None,
        }
    return {
        "symbol": "BTC",
        "asset_type": "crypto",
        "status": "ok",
        "error": None,
        "source": payload.get("source"),
        "provider": payload.get("provider"),
        "fetch_source": payload.get("fetch_source"),
        "stale": payload.get("stale"),
        "as_of": payload.get("as_of"),
        "price": payload.get("price"),
        "change_pct_24h": payload.get("change_pct_24h"),
    }


async def read_dataset_status(db: AsyncSession) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            SELECT
              (SELECT COUNT(*) FROM news_items) AS news_total,
              (SELECT COUNT(*) FROM news_items WHERE published_at >= NOW() - INTERVAL '24 hours') AS news_last_24h,
              (SELECT MAX(published_at) FROM news_items) AS latest_news_at,
              (SELECT COUNT(*) FROM market_events) AS events_total,
              (SELECT COUNT(*) FROM market_events WHERE event_date >= CURRENT_DATE AND event_date <= CURRENT_DATE + INTERVAL '30 days') AS upcoming_events_30d,
              (SELECT MAX(COALESCE(event_time, event_date::timestamptz)) FROM market_events) AS latest_event_at,
              (SELECT COUNT(*) FROM watchlist_items) AS watchlist_total
            """
        )
    )
    row = result.mappings().one()
    return {
        "status": "ok",
        "news_items_total": int(row.get("news_total") or 0),
        "news_items_last_24h": int(row.get("news_last_24h") or 0),
        "latest_news_at": _normalize_iso_timestamp(row.get("latest_news_at")),
        "market_events_total": int(row.get("events_total") or 0),
        "upcoming_events_30d": int(row.get("upcoming_events_30d") or 0),
        "latest_event_at": _normalize_iso_timestamp(row.get("latest_event_at")),
        "watchlist_items_total": int(row.get("watchlist_total") or 0),
    }


async def _read_runtime_samples(db: AsyncSession) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    stock_task = asyncio.to_thread(read_stock_quote_sample)
    crypto_task = asyncio.to_thread(read_crypto_quote_sample)
    dataset_task = read_dataset_status(db)
    stock_quote_aapl, crypto_quote_btc, datasets = await asyncio.gather(stock_task, crypto_task, dataset_task)
    return stock_quote_aapl, crypto_quote_btc, datasets


async def _build_data_status_payload(
    cfg: Settings,
    db: AsyncSession,
    *,
    generated_at: datetime | None = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    generated = generated_at or _utc_now()
    report = run_provider_health_check(generated, force_refresh=force_refresh, include_ohlcv_checks=False)
    llm = LLMService(cfg)
    stock_quote_aapl, crypto_quote_btc, datasets = await _read_runtime_samples(db)
    return {
        "data": {
            "provider_health": report,
            "llm": llm.summary(),
            "feature_flags": {
                "enable_news_fetch": cfg.enable_news_fetch,
                "enable_cn_data": cfg.enable_cn_data,
                "enable_llm_analysis": cfg.enable_llm_analysis,
            },
            "stock_quote_aapl": stock_quote_aapl,
            "crypto_quote_btc": crypto_quote_btc,
            "datasets": datasets,
        },
        "meta": {
            "generated_at": generated.isoformat(),
            "served_from_cache": False,
            "cache_ttl_sec": cfg.provider_health_cache_ttl_sec,
        },
    }


@router.get("/health")
async def health(request: Request) -> dict[str, Any]:
    cfg = _runtime_settings(request)
    return {
        "status": "ok",
        "version": "v2",
        "features": {
            "research_apis": cfg.enable_research_apis,
            "ai_api": cfg.enable_ai_api,
            "llm_analysis": cfg.enable_llm_analysis,
            "news_fetch": cfg.enable_news_fetch,
            "cn_data": cfg.enable_cn_data,
        },
    }


@router.get("/data-status")
async def data_status(
    request: Request,
    force_refresh: bool = Query(False),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    cfg = _runtime_settings(request)
    if not _cache_enabled(cfg):
        return await _build_data_status_payload(cfg, db, force_refresh=force_refresh)

    if force_refresh:
        async with _data_status_lock:
            now = _utc_now()
            payload = await _build_data_status_payload(cfg, db, generated_at=now, force_refresh=True)
            _data_status_cache["payload"] = deepcopy(payload)
            _data_status_cache["expires_at"] = _cache_expires_at(cfg, now)
            return payload

    now = _utc_now()
    cached = _read_cached_data_status(now)
    if cached is not None:
        return cached

    async with _data_status_lock:
        now = _utc_now()
        cached = _read_cached_data_status(now)
        if cached is not None:
            return cached
        payload = await _build_data_status_payload(cfg, db, generated_at=now, force_refresh=False)
        _data_status_cache["payload"] = deepcopy(payload)
        _data_status_cache["expires_at"] = _cache_expires_at(cfg, now)
        return payload


@router.get("/observability")
async def get_observability(
    route_limit: int = Query(8, ge=1, le=20),
    failing_limit: int = Query(6, ge=1, le=20),
    counter_limit: int = Query(20, ge=1, le=50),
) -> dict[str, Any]:
    return await system_v1.get_observability(route_limit=route_limit, failing_limit=failing_limit, counter_limit=counter_limit)


@router.get("/cache-maintenance")
async def get_cache_maintenance(request: Request, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await system_v1.get_cache_maintenance(request=request, db=db)


@router.post("/cache-maintenance/cleanup")
async def cleanup_cache_maintenance(
    request: Request,
    dry_run: bool = Query(True),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await system_v1.cleanup_cache_maintenance(request=request, dry_run=dry_run, db=db)
