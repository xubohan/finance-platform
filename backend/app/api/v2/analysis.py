"""V2 analysis routes."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.analysis import EventImpactRequest, SentimentRequest
from app.services.analysis_controller import AnalysisController
from app.services.ohlcv_store import load_ohlcv_window
from app.services.openbb_adapter import detect_provider, fetch_stock_snapshot_with_meta

router = APIRouter()
controller = AnalysisController()


@router.post("/sentiment")
async def analyze_sentiment(payload: SentimentRequest) -> dict[str, Any]:
    return await controller.analyze_sentiment(text=payload.text, context_symbols=payload.context_symbols)


@router.post("/event-impact")
async def analyze_event_impact(payload: EventImpactRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await controller.run_event_impact(db=db, payload=payload)
    task_id = controller.queue_local_result(result)
    return {"data": {"task_id": task_id}, "meta": {"accepted_at": datetime.now(timezone.utc).isoformat()}}


@router.get("/tasks/{task_id}")
async def get_analysis_task(task_id: str) -> dict[str, Any]:
    payload = controller.get_task_status(task_id)
    if payload.get("status") == "not_found":
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Analysis task not found"}})
    if payload.get("status") == "failed":
        raise HTTPException(status_code=500, detail={"error": {"code": "TASK_FAILED", "message": payload.get("error", "Analysis task failed")}})
    if payload.get("status") == "pending":
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
            prefer_local=True,
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
        force_refresh=False,
        allow_stale=True,
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
    return {"data": rows, "meta": {"count": len(rows), "generated_at": datetime.now(timezone.utc).isoformat()}}
