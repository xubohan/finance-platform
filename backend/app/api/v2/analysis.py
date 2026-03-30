"""V2 analysis routes."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.analysis import EventImpactRequest, SentimentRequest
from app.services.analysis_controller import AnalysisController
from app.services.cn_market_sync import fetch_sector_flow_snapshot
from app.services.ohlcv_store import load_ohlcv_window
from app.services.openbb_adapter import detect_provider, fetch_stock_snapshot_with_meta

try:
    from tasks.analysis_tasks import run_event_impact as run_event_impact_task
except Exception:  # pragma: no cover - local/unit test fallback
    run_event_impact_task = None

router = APIRouter()
controller = AnalysisController()
logger = logging.getLogger(__name__)
_CN_TZ = ZoneInfo("Asia/Shanghai")


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


def _latest_market_as_of(rows: list[dict[str, Any]]) -> str | None:
    latest = max(
        (_normalize_timestamp(row.get("as_of")) for row in rows),
        default=None,
        key=lambda item: item or datetime.min.replace(tzinfo=timezone.utc),
    )
    return latest.isoformat() if latest is not None else None


def _cn_flow_snapshot_is_stale(as_of: str | None) -> bool:
    parsed = _normalize_timestamp(as_of)
    if parsed is None:
        return True
    return parsed.astimezone(_CN_TZ).date() != datetime.now(_CN_TZ).date()


def _cn_flow_trade_date_is_stale(value: Any) -> bool:
    if isinstance(value, datetime):
        trade_date = value.astimezone(_CN_TZ).date()
    elif isinstance(value, date):
        trade_date = value
    elif isinstance(value, str):
        try:
            trade_date = date.fromisoformat(value[:10])
        except ValueError:
            return True
    else:
        return True
    return trade_date != datetime.now(_CN_TZ).date()


@router.post("/sentiment")
async def analyze_sentiment(payload: SentimentRequest) -> dict[str, Any]:
    return await controller.analyze_sentiment(text=payload.text, context_symbols=payload.context_symbols)


@router.post("/event-impact", status_code=202)
async def analyze_event_impact(payload: EventImpactRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    task_runner = run_event_impact_task
    delay = getattr(task_runner, "delay", None) if task_runner is not None else None
    if callable(delay):
        try:
            async_result = delay(payload.model_dump(mode="json"))
            task_id = controller.register_remote_task(str(async_result.id), backend="celery")
            return {
                "data": {"task_id": task_id},
                "meta": {
                    "accepted_at": datetime.now(timezone.utc).isoformat(),
                    "execution_mode": "celery",
                },
            }
        except Exception as exc:  # pragma: no cover - depends on runtime broker state
            logger.warning("analysis event-impact celery dispatch failed: %s", exc)
            raise HTTPException(
                status_code=503,
                detail={"error": {"code": "TASK_DISPATCH_FAILED", "message": f"Failed to dispatch analysis task: {exc}"}},
            ) from exc

    raise HTTPException(
        status_code=503,
        detail={"error": {"code": "TASK_DISPATCH_UNAVAILABLE", "message": "Event impact analysis requires a running task queue"}},
    )


@router.get("/tasks/{task_id}")
async def get_analysis_task(task_id: str) -> dict[str, Any]:
    payload = controller.get_task_status(task_id)
    if payload.get("status") == "not_found":
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Analysis task not found"}})
    if payload.get("status") == "pending":
        return payload
    if payload.get("status") == "failed":
        return payload
    if "result" not in payload:
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Analysis task not found"}})
    return payload


@router.get("/correlation")
async def get_correlation(
    symbols: str = Query(..., min_length=3),
    period: str = Query("90d", pattern="^[0-9]+d$"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    normalized_symbols = [item.strip().upper() for item in symbols.split(",") if item.strip()]
    if len(normalized_symbols) < 2:
        raise HTTPException(status_code=400, detail={"error": {"code": "INVALID_SYMBOLS", "message": "At least two symbols are required"}})
    days = int(period[:-1])
    end_date = date.today().isoformat()
    start_date = (date.today() - timedelta(days=days)).isoformat()
    series_map: dict[str, pd.Series] = {}
    for symbol in normalized_symbols:
        asset_type, _ = detect_provider(symbol)
        frame, _ = await load_ohlcv_window(
            db=db,
            symbol=symbol,
            asset_type=asset_type,
            start_date=start_date,
            end_date=end_date,
            interval="1d",
            prefer_local=False,
            sync_if_missing=True,
        )
        if frame.empty:
            continue
        working = frame.copy()
        working["trade_date"] = pd.to_datetime(working["time"], utc=True).dt.date
        series_map[symbol] = working.drop_duplicates(subset=["trade_date"]).set_index("trade_date")["close"]

    if len(series_map) < 2:
        return {"data": {"symbols": list(series_map.keys()), "matrix": []}, "meta": {"period": period, "rows": 0}}

    merged = pd.concat(series_map, axis=1, join="inner").dropna()
    if merged.empty:
        return {"data": {"symbols": list(series_map.keys()), "matrix": []}, "meta": {"period": period, "rows": 0}}

    corr = merged.corr().round(4)
    matrix = [
        {
            "symbol": symbol,
            "correlations": {other: float(corr.loc[symbol, other]) for other in corr.columns},
        }
        for symbol in corr.index
    ]
    return {"data": {"symbols": list(corr.columns), "matrix": matrix}, "meta": {"period": period, "rows": int(len(merged))}}


@router.get("/sector-heatmap")
async def get_sector_heatmap(market: str = Query("us", pattern="^(us|cn)$")) -> dict[str, Any]:
    snapshots, snapshot_meta = fetch_stock_snapshot_with_meta(
        market=market,
        limit=600,
        force_refresh=True,
        allow_stale=False,
    )
    if not snapshots:
        return {
            "data": [],
            "meta": {
                "market": market,
                "count": 0,
                "source": snapshot_meta.get("source"),
                "stale": snapshot_meta.get("stale"),
                "as_of": snapshot_meta.get("as_of"),
                "cache_age_sec": snapshot_meta.get("cache_age_sec"),
                "grouping": "market_cap_bucket",
            },
        }

    frame = pd.DataFrame(snapshots)
    if frame.empty:
        return {
            "data": [],
            "meta": {
                "market": market,
                "count": 0,
                "source": snapshot_meta.get("source"),
                "stale": snapshot_meta.get("stale"),
                "as_of": snapshot_meta.get("as_of"),
                "cache_age_sec": snapshot_meta.get("cache_age_sec"),
                "grouping": "market_cap_bucket",
            },
        }

    frame["change_pct"] = pd.to_numeric(frame.get("change_pct"), errors="coerce")
    frame["market_cap"] = pd.to_numeric(frame.get("market_cap"), errors="coerce")
    frame["bucket"] = "Small Cap"
    frame.loc[frame["market_cap"] >= 5_000_000_000, "bucket"] = "Mid Cap"
    frame.loc[frame["market_cap"] >= 20_000_000_000, "bucket"] = "Large Cap"
    frame.loc[frame["market_cap"] >= 200_000_000_000, "bucket"] = "Mega Cap"
    frame.loc[frame["market_cap"].isna(), "bucket"] = "Unknown"

    bucket_order = ["Mega Cap", "Large Cap", "Mid Cap", "Small Cap", "Unknown"]
    rows: list[dict[str, Any]] = []
    for bucket in bucket_order:
        part = frame[frame["bucket"] == bucket]
        if part.empty:
            continue
        changes = part["change_pct"].dropna()
        advancers = int((changes > 0).sum())
        decliners = int((changes < 0).sum())
        flat = int((changes == 0).sum())
        avg_change = float(changes.mean()) if not changes.empty else 0.0
        median_change = float(changes.median()) if not changes.empty else 0.0
        market_cap_total = pd.to_numeric(part["market_cap"], errors="coerce").dropna().sum()
        rows.append(
            {
                "sector": bucket,
                "count": int(len(part)),
                "avg_change_pct": round(avg_change, 4),
                "median_change_pct": round(median_change, 4),
                "advancers": advancers,
                "decliners": decliners,
                "flat": flat,
                "total_market_cap": float(market_cap_total) if pd.notna(market_cap_total) else 0.0,
                "heat_score": round(avg_change * min(1.0, len(part) / 30), 4),
            }
        )

    return {
        "data": rows,
        "meta": {
            "market": market,
            "count": len(rows),
            "symbols_considered": int(len(frame)),
            "source": snapshot_meta.get("source"),
            "stale": snapshot_meta.get("stale"),
            "as_of": snapshot_meta.get("as_of"),
            "cache_age_sec": snapshot_meta.get("cache_age_sec"),
            "grouping": "market_cap_bucket",
        },
    }


@router.get("/cn-flow-heatmap")
async def get_cn_flow_heatmap(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).isoformat()
    result = await db.execute(
        text(
            """
            SELECT symbol, trade_date, main_net, super_large_net, large_net, medium_net, small_net
            FROM cn_big_order_flow
            ORDER BY trade_date DESC, main_net DESC NULLS LAST
            LIMIT 30
            """
        )
    )
    rows = [dict(row) for row in result.mappings().all()]
    if rows:
        latest_trade_date = max((row.get("trade_date") for row in rows if row.get("trade_date") is not None), default=None)
        return {
            "data": rows,
            "meta": {
                "count": len(rows),
                "generated_at": generated_at,
                "source": "persisted",
                "stale": _cn_flow_trade_date_is_stale(latest_trade_date),
                "as_of": latest_trade_date.isoformat() if hasattr(latest_trade_date, "isoformat") else latest_trade_date,
                "entity_type": "symbol",
            },
        }

    try:
        live_rows = fetch_sector_flow_snapshot(limit=30)
    except Exception as exc:
        logger.warning("cn flow heatmap live fallback failed: %s", exc)
        return {
            "data": [],
            "meta": {
                "count": 0,
                "generated_at": generated_at,
                "source": "persisted",
                "stale": True,
                "as_of": None,
                "entity_type": "symbol",
                "fallback_error": str(exc),
            },
        }

    as_of = _latest_market_as_of(live_rows)
    return {
        "data": live_rows,
        "meta": {
            "count": len(live_rows),
            "generated_at": generated_at,
            "source": "eastmoney_sector_flow",
            "stale": _cn_flow_snapshot_is_stale(as_of),
            "as_of": as_of,
            "entity_type": "sector",
        },
    }
