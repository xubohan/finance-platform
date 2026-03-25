"""V2 market routes."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import market as market_v1
from app.database import get_db
from app.services.cn_market_sync import ensure_big_order_flow, ensure_dragon_tiger_data, ensure_margin_data, ensure_northbound_flow
from app.services.openbb_adapter import (
    detect_provider,
    fetch_crypto_realtime_price,
    fetch_fundamentals,
    fetch_ohlcv_with_meta,
    fetch_stock_snapshot_with_meta,
)

router = APIRouter()

_TRACKED_CRYPTO_SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "DOGE", "DOT"]


def _normalize_market_code(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    if normalized in {"us", "usa"}:
        return "us"
    if normalized in {"cn", "sh", "sz"}:
        return "cn"
    if normalized in {"crypto"}:
        return "crypto"
    return normalized


@router.get("/search")
async def search_assets(
    q: str = Query(..., min_length=1),
    type: str = Query("all", pattern="^(all|stock|crypto)$"),
    market: str = Query("all", pattern="^(all|us|cn|crypto)$"),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    response = await market_v1.search_assets(q=q, type=type, limit=max(limit * 2, 10), db=db)
    rows = response.get("data", [])
    if market != "all":
        rows = [row for row in rows if _normalize_market_code(str(row.get("market"))) == market]
    return {
        "data": rows[:limit],
        "meta": {
            **response.get("meta", {}),
            "count": len(rows[:limit]),
            "market": market,
            "type": type,
        },
    }


@router.get("/{symbol}/quote")
async def get_quote(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await market_v1.get_quote(symbol=symbol, db=db)


@router.get("/{symbol}/kline")
async def get_kline(
    symbol: str,
    period: str = Query("1d", pattern="^(1m|5m|1h|1d|1w|1M|1W)$"),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    normalized_period = {"1w": "1W"}.get(period, period)
    if normalized_period in {"1m", "5m", "1h"}:
        if not end:
            end = date.today().strftime("%Y-%m-%d")
        if not start:
            lookback_days = {"1m": 2, "5m": 14, "1h": 90}[normalized_period]
            start = (date.today() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
        market_v1._validate_date_range(start, end)

        normalized_symbol = symbol.upper()
        asset_type, _ = detect_provider(normalized_symbol)
        frame, meta = fetch_ohlcv_with_meta(
            symbol=normalized_symbol,
            start_date=start,
            end_date=end,
            interval=normalized_period,
        )
        if frame.empty:
            raise HTTPException(
                status_code=502,
                detail={"error": {"code": "UPSTREAM_UNAVAILABLE", "message": f"Failed to fetch intraday kline data for {normalized_symbol}"}},
            )
        data = [
            {
                "time": row.time.isoformat(),
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
                "volume": float(row.volume),
            }
            for row in frame.itertuples(index=False)
        ]
        return {
            "data": data,
            "meta": {
                "symbol": normalized_symbol,
                "period": normalized_period,
                "start": start,
                "end": end,
                "asset_type": asset_type,
                "source": meta.get("source"),
                "stale": meta.get("stale"),
                "as_of": meta.get("as_of"),
                "provider": meta.get("provider"),
                "fetch_source": meta.get("fetch_source"),
                "sync_performed": False,
                "coverage_complete": True,
                "count": len(data),
                "local_history_synced": False,
            },
        }

    return await market_v1.get_kline(symbol=symbol, period=normalized_period, start=start, end=end, db=db)


@router.get("/{symbol}/summary")
async def get_summary(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await market_v1.get_summary(symbol=symbol, db=db)


@router.post("/batch/quotes")
async def get_batch_quotes(payload: market_v1.BatchQuoteRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await market_v1.get_quotes(payload=payload, db=db)


@router.get("/movers")
async def get_movers(
    market: str = Query("us", pattern="^(us|cn|crypto|all)$"),
    direction: Literal["gain", "loss"] = Query("gain"),
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    if market == "crypto":
        quotes = fetch_crypto_realtime_price(_TRACKED_CRYPTO_SYMBOLS)
        rows = [
            {
                "symbol": symbol,
                "market": "crypto",
                "change_pct": float(payload.get("change_pct_24h") or 0),
                "latest": float(payload.get("price") or 0),
            }
            for symbol, payload in quotes.items()
        ]
        rows.sort(key=lambda item: item["change_pct"], reverse=(direction == "gain"))
        return {
            "data": rows[:limit],
            "meta": {"count": len(rows[:limit]), "market": market, "direction": direction, "source": "live"},
        }

    snapshots, meta = fetch_stock_snapshot_with_meta(
        market="all" if market == "all" else market,
        limit=max(limit * 5, 50),
        force_refresh=False,
        allow_stale=True,
    )
    if not snapshots:
        raise HTTPException(status_code=502, detail={"error": {"code": "UPSTREAM_UNAVAILABLE", "message": "Failed to load market movers"}})
    rows = []
    for row in snapshots:
        row_market = _normalize_market_code(str(row.get("market")))
        if market != "all" and row_market != market:
            continue
        if row.get("change_pct") is None or row.get("last_price") is None:
            continue
        rows.append(
            {
                "symbol": str(row.get("symbol", "")).upper(),
                "market": row_market,
                "change_pct": float(row.get("change_pct") or 0),
                "latest": float(row.get("last_price") or 0),
            }
        )
    rows.sort(key=lambda item: item["change_pct"], reverse=(direction == "gain"))
    return {"data": rows[:limit], "meta": {"count": len(rows[:limit]), "market": market, "direction": direction, **meta}}


@router.get("/{symbol}/financials")
async def get_financials(
    symbol: str,
    report_type: str = Query("income", pattern="^(income|balance|cashflow)$"),
    period: str = Query("annual", pattern="^(annual|quarterly)$"),
    limit: int = Query(8, ge=1, le=20),
) -> dict[str, Any]:
    frame = fetch_fundamentals(symbol)
    if frame.empty:
        return {"data": [], "meta": {"count": 0, "report_type": report_type, "period": period}}
    rows = frame.astype(object).where(pd.notna(frame), None).to_dict("records")
    return {"data": rows[:limit], "meta": {"count": min(len(rows), limit), "report_type": report_type, "period": period}}


@router.get("/{symbol}/margin")
async def get_margin(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    query = text(
        """
        SELECT trade_date, rzye, rzmre, rqyl, rqmcl, rzrqye
        FROM cn_margin_trading
        WHERE symbol = :symbol
        ORDER BY trade_date DESC
        LIMIT 60
        """
    )
    params = {"symbol": symbol.upper()}
    result = await db.execute(query, params)
    rows = [dict(row) for row in result.mappings().all()]
    if not rows and symbol.upper().endswith((".SH", ".SZ", ".BJ")):
        await ensure_margin_data(db, symbol.upper())
        result = await db.execute(query, params)
        rows = [dict(row) for row in result.mappings().all()]
    return {"data": rows, "meta": {"count": len(rows), "symbol": symbol.upper()}}


@router.get("/{symbol}/dragon-tiger")
async def get_dragon_tiger(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    query = text(
        """
        SELECT trade_date, reason, net_buy, buy_amount, sell_amount, top_buyers, top_sellers, created_at
        FROM cn_dragon_tiger
        WHERE symbol = :symbol
        ORDER BY trade_date DESC
        LIMIT 20
        """
    )
    params = {"symbol": symbol.upper()}
    result = await db.execute(query, params)
    rows = [dict(row) for row in result.mappings().all()]
    if not rows and symbol.upper().endswith((".SH", ".SZ", ".BJ")):
        await ensure_dragon_tiger_data(db, symbol.upper())
        result = await db.execute(query, params)
        rows = [dict(row) for row in result.mappings().all()]
    return {"data": rows, "meta": {"count": len(rows), "symbol": symbol.upper()}}


@router.get("/{symbol}/big-order")
async def get_big_order_flow(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    query = text(
        """
        SELECT trade_date, super_large_net, large_net, medium_net, small_net, main_net
        FROM cn_big_order_flow
        WHERE symbol = :symbol
        ORDER BY trade_date DESC
        LIMIT 20
        """
    )
    params = {"symbol": symbol.upper()}
    result = await db.execute(query, params)
    rows = [dict(row) for row in result.mappings().all()]
    if not rows and symbol.upper().endswith((".SH", ".SZ", ".BJ")):
        await ensure_big_order_flow(db, symbol.upper())
        result = await db.execute(query, params)
        rows = [dict(row) for row in result.mappings().all()]
    return {"data": rows, "meta": {"count": len(rows), "symbol": symbol.upper()}}


@router.get("/northbound")
async def get_northbound(
    trade_date: date | None = Query(None, alias="date"),
    market: str = Query("all", pattern="^(sh|sz|all)$"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clauses = ["1=1"]
    params: dict[str, object] = {}
    if trade_date:
        clauses.append("trade_date = :trade_date")
        params["trade_date"] = trade_date
    if market != "all":
        clauses.append("market = :market")
        params["market"] = market.upper()
    query = f"""
        SELECT trade_date, market, net_buy, buy_amount, sell_amount, hold_amount
        FROM cn_northbound_flow
        WHERE {' AND '.join(clauses)}
        ORDER BY trade_date DESC, market ASC
        LIMIT 20
    """
    result = await db.execute(text(query), params)
    rows = [dict(row) for row in result.mappings().all()]
    if not rows:
        await ensure_northbound_flow(db)
        result = await db.execute(text(query), params)
        rows = [dict(row) for row in result.mappings().all()]
    return {"data": rows, "meta": {"count": len(rows), "market": market, "trade_date": trade_date}}


@router.get("/calendar")
async def get_market_calendar(
    start: date | None = Query(None),
    end: date | None = Query(None),
    market: str = Query("all", pattern="^(us|cn|crypto|all)$"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    clauses = ["1=1"]
    params: dict[str, object] = {}
    if start:
        clauses.append("event_date >= :start_date")
        params["start_date"] = start
    if end:
        clauses.append("event_date <= :end_date")
        params["end_date"] = end
    if market != "all":
        clauses.append(":market = ANY(markets)")
        params["market"] = market
    result = await db.execute(
        text(
            f"""
            SELECT id, title, event_type, event_date, event_time, symbols, markets, importance
            FROM market_events
            WHERE {' AND '.join(clauses)}
            ORDER BY event_date ASC, importance DESC
            LIMIT 200
            """
        ),
        params,
    )
    rows = [dict(row) for row in result.mappings().all()]
    return {"data": rows, "meta": {"count": len(rows), "market": market, "start": start, "end": end}}


@router.get("/{symbol}/history-status")
async def history_status(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await market_v1.history_status(symbol=symbol, db=db)


@router.post("/{symbol}/sync")
async def sync_history(
    symbol: str,
    payload: market_v1.HistorySyncRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    return await market_v1.sync_history(symbol=symbol, payload=payload, db=db)
