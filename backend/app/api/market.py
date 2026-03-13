"""Market data HTTP routes (search, kline, realtime, movers)."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
import pandas as pd
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.market_cache import cache_get_json, cache_set_json
from app.services.ohlcv_store import get_local_ohlcv_summary, load_ohlcv_window, read_local_ohlcv, sync_ohlcv_from_upstream
from app.services.openbb_adapter import (
    detect_provider,
    fetch_crypto_realtime_price,
    fetch_ohlcv_with_meta,
    fetch_stock_snapshot_with_meta,
    fetch_stock_symbols_with_meta,
)

router = APIRouter()

CRYPTO_QUOTE_FRESH_TTL_SECONDS = 45
CRYPTO_QUOTE_STALE_TTL_SECONDS = 15 * 60
CRYPTO_QUOTE_RETRY_ATTEMPTS = 3
CRYPTO_QUOTE_RETRY_BACKOFF_SECONDS = 0.25
QUOTE_LOOKBACK_DAYS = 10
QUOTE_LOCAL_MAX_AGE_DAYS = 5


class HistorySyncRequest(BaseModel):
    """Manual sync request for local OHLCV coverage."""

    start_date: str
    end_date: str
    period: str = Field("1d", pattern="^(1d)$")


class BatchQuoteRequest(BaseModel):
    """Batch quote request for watchlist-style workloads."""

    symbols: list[str] = Field(default_factory=list, min_length=1, max_length=25)


def _error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    """Project-wide API error response shape."""
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
        "request_id": "",
    }


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _cache_age_seconds(as_of: str | None) -> int | None:
    parsed = _parse_iso_datetime(as_of)
    if parsed is None:
        return None
    return max(0, int((datetime.now(timezone.utc) - parsed).total_seconds()))


def _validate_date_range(start_date: str, end_date: str) -> None:
    """Reject malformed or reversed date ranges before live sync."""
    try:
        start_ts = datetime.fromisoformat(start_date)
        end_ts = datetime.fromisoformat(end_date)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_DATE_FORMAT", "start_date and end_date must be valid dates in YYYY-MM-DD format", {}),
        ) from exc

    if start_ts >= end_ts:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_DATE_RANGE", "start_date must be earlier than end_date", {}),
        )


def _crypto_quote_cache_keys(symbol: str) -> tuple[str, str]:
    normalized = symbol.upper().strip()
    return (
        f"market:quote:crypto:fresh:{normalized}",
        f"market:quote:crypto:stale:{normalized}",
    )


def _read_crypto_quote_cache(symbol: str, *, allow_stale: bool) -> tuple[dict[str, Any] | None, bool]:
    fresh_key, stale_key = _crypto_quote_cache_keys(symbol)
    fresh = cache_get_json(fresh_key)
    if isinstance(fresh, dict):
        return fresh, False
    if allow_stale:
        stale = cache_get_json(stale_key)
        if isinstance(stale, dict):
            return stale, True
    return None, False


def _write_crypto_quote_cache(symbol: str, payload: dict[str, Any]) -> None:
    fresh_key, stale_key = _crypto_quote_cache_keys(symbol)
    cache_set_json(fresh_key, payload, CRYPTO_QUOTE_FRESH_TTL_SECONDS)
    cache_set_json(stale_key, payload, CRYPTO_QUOTE_STALE_TTL_SECONDS)


def _fetch_crypto_quote_live(symbol: str) -> dict[str, Any] | None:
    for attempt in range(CRYPTO_QUOTE_RETRY_ATTEMPTS):
        try:
            rows = fetch_crypto_realtime_price([symbol])
        except Exception:
            rows = {}
        quote = rows.get(symbol) if isinstance(rows, dict) else None
        if isinstance(quote, dict) and quote.get("price") is not None:
            return quote
        if attempt < CRYPTO_QUOTE_RETRY_ATTEMPTS - 1:
            time.sleep(CRYPTO_QUOTE_RETRY_BACKOFF_SECONDS * (attempt + 1))
    return None


def _resample_ohlcv(frame, period: str):
    """Convert local daily OHLCV into chart interval bars."""
    if frame.empty or period == "1d":
        return frame

    rule = "W-FRI" if period == "1W" else "ME"
    working = frame.copy()
    working["time"] = pd.to_datetime(working["time"], utc=True)

    rows: list[dict[str, Any]] = []
    for _, bucket in working.groupby(pd.Grouper(key="time", freq=rule)):
        if bucket.empty:
            continue
        rows.append(
            {
                "time": bucket["time"].iloc[-1],
                "open": float(bucket["open"].iloc[0]),
                "high": float(bucket["high"].max()),
                "low": float(bucket["low"].min()),
                "close": float(bucket["close"].iloc[-1]),
                "volume": float(bucket["volume"].sum()),
            }
        )

    if not rows:
        return frame.iloc[0:0]
    return pd.DataFrame(rows)


async def _load_stock_quote_frame(
    db: AsyncSession | None,
    symbol: str,
    *,
    end_date: str,
) -> tuple[Any, dict[str, Any]]:
    """Load stock quote bars with a looser local-hit rule than full chart coverage."""
    start_date = (date.fromisoformat(end_date) - timedelta(days=QUOTE_LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    local_df = await read_local_ohlcv(db, symbol, "stock", start_date, end_date)
    if len(local_df) >= 2:
        last_time = pd.to_datetime(local_df["time"].iloc[-1], utc=True)
        cutoff = pd.to_datetime(end_date, utc=True) - pd.Timedelta(days=QUOTE_LOCAL_MAX_AGE_DAYS)
        if last_time >= cutoff:
            return local_df, {
                "source": "local",
                "stale": False,
                "as_of": last_time.isoformat(),
                "provider": "local",
                "fetch_source": "database",
                "sync_performed": False,
                "coverage_complete": True,
            }

    synced_df, live_meta = await sync_ohlcv_from_upstream(
        db=db,
        symbol=symbol,
        asset_type="stock",
        start_date=start_date,
        end_date=end_date,
        interval="1d",
    )
    if synced_df.empty:
        return synced_df, {
            "source": live_meta.get("source"),
            "stale": live_meta.get("stale"),
            "as_of": live_meta.get("as_of"),
            "provider": live_meta.get("provider"),
            "fetch_source": live_meta.get("fetch_source"),
            "sync_performed": True,
            "coverage_complete": False,
        }

    reread_df = await read_local_ohlcv(db, symbol, "stock", start_date, end_date)
    if len(reread_df) >= 2:
        last_time = pd.to_datetime(reread_df["time"].iloc[-1], utc=True)
        return reread_df, {
            "source": "local",
            "stale": False,
            "as_of": last_time.isoformat(),
            "provider": live_meta.get("provider"),
            "fetch_source": live_meta.get("fetch_source"),
            "sync_performed": True,
            "coverage_complete": True,
        }

    return synced_df, {
        "source": live_meta.get("source"),
        "stale": live_meta.get("stale"),
        "as_of": live_meta.get("as_of"),
        "provider": live_meta.get("provider"),
        "fetch_source": live_meta.get("fetch_source"),
        "sync_performed": True,
        "coverage_complete": False,
    }


async def _build_history_status_payload(
    db: AsyncSession | None,
    symbol: str,
    asset_type: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build reusable local history coverage payload."""
    summary = await get_local_ohlcv_summary(db, symbol, asset_type)
    return (
        {
            "symbol": symbol,
            "asset_type": asset_type,
            "local_rows": summary["count"],
            "local_start": summary["start"],
            "local_end": summary["end"],
            "has_data": summary["count"] > 0,
        },
        {"count": int(summary["count"]), "symbol": symbol, "asset_type": asset_type},
    )


@router.get("/search")
async def search_assets(
    q: str = Query(..., min_length=1),
    type: str = Query("all", pattern="^(all|stock|crypto)$"),
    limit: int = Query(10, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Unified search endpoint with live stock universe."""
    keyword = q.strip()
    keyword_upper = keyword.upper()
    rows: list[dict[str, Any]] = []
    stock_meta: dict[str, Any] = {"source": None, "stale": None, "as_of": None, "cache_age_sec": None}

    if type in ("all", "stock"):
        live_universe, stock_meta = fetch_stock_symbols_with_meta(
            market="all",
            limit=600,
            force_refresh=False,
            allow_stale=True,
        )
        if not live_universe and type == "stock":
            raise HTTPException(
                status_code=502,
                detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest stock symbol universe", {}),
            )
        for item in live_universe:
            symbol = str(item.get("symbol", "")).upper()
            name = str(item.get("name", ""))
            if keyword_upper in symbol or keyword_upper in name.upper():
                rows.append(
                    {
                        "symbol": symbol,
                        "name": name,
                        "asset_type": "stock",
                        "market": item.get("market"),
                    }
                )
                if len(rows) >= limit:
                    return {
                        "data": rows,
                        "meta": {
                            "count": len(rows),
                            "source": stock_meta.get("source"),
                            "stale": stock_meta.get("stale"),
                            "as_of": stock_meta.get("as_of"),
                            "cache_age_sec": stock_meta.get("cache_age_sec"),
                        },
                    }

    if type in ("all", "crypto") and len(rows) < limit:
        stmt = text(
            """
            SELECT symbol, name, asset_type, market
            FROM assets
            WHERE asset_type = 'crypto'
              AND (symbol ILIKE :kw OR name ILIKE :kw)
            ORDER BY symbol
            LIMIT :limit
            """
        )
        result = await db.execute(stmt, {"kw": f"%{keyword}%", "limit": limit - len(rows)})
        rows.extend(
            [
                {
                    "symbol": row.symbol,
                    "name": row.name,
                    "asset_type": row.asset_type,
                    "market": row.market,
                }
                for row in result.fetchall()
            ]
        )

    return {
        "data": rows[:limit],
        "meta": {
            "count": len(rows[:limit]),
            "source": stock_meta.get("source"),
            "stale": stock_meta.get("stale"),
            "as_of": stock_meta.get("as_of"),
            "cache_age_sec": stock_meta.get("cache_age_sec"),
        },
    }


@router.get("/snapshot/history")
async def snapshot_history(
    market: str = Query("us", pattern="^(us|cn|all)$"),
    days: int = Query(7, ge=1, le=90),
    limit: int = Query(200, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Inspect locally persisted daily snapshot rows for acceleration diagnostics."""
    try:
        stmt = text(
            """
            SELECT trade_date, market, symbol, payload
            FROM market_snapshot_daily
            WHERE (:market = 'all' OR market = :market_upper)
              AND trade_date >= CURRENT_DATE - CAST(:days AS INTEGER)
            ORDER BY trade_date DESC, symbol ASC
            LIMIT :limit
            """
        )
        result = await db.execute(
            stmt,
            {
                "market": market.lower(),
                "market_upper": market.upper(),
                "days": days,
                "limit": limit,
            },
        )
        rows = result.fetchall()
    except Exception:
        rows = []

    data = [
        {
            "trade_date": str(row.trade_date),
            "market": row.market,
            "symbol": row.symbol,
            "payload": row.payload,
        }
        for row in rows
    ]
    return {"data": data, "meta": {"count": len(data), "market": market, "days": days, "limit": limit}}


@router.get("/{symbol}/history-status")
async def history_status(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Return local OHLCV coverage summary for a symbol."""
    normalized_symbol = symbol.upper()
    asset_type, _ = detect_provider(normalized_symbol)
    data, meta = await _build_history_status_payload(db, normalized_symbol, asset_type)
    return {
        "data": data,
        "meta": meta,
    }


@router.post("/{symbol}/sync")
async def sync_history(
    symbol: str,
    payload: HistorySyncRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Fetch OHLCV from upstream and persist it locally."""
    _validate_date_range(payload.start_date, payload.end_date)
    normalized_symbol = symbol.upper()
    asset_type, _ = detect_provider(normalized_symbol)
    synced_df, synced_meta = await sync_ohlcv_from_upstream(
        db=db,
        symbol=normalized_symbol,
        asset_type=asset_type,
        start_date=payload.start_date,
        end_date=payload.end_date,
        interval=payload.period,
    )
    if synced_df.empty:
        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Failed to sync latest kline data", {"symbol": normalized_symbol}),
        )

    summary = await get_local_ohlcv_summary(db, normalized_symbol, asset_type)
    return {
        "data": {
            "symbol": normalized_symbol,
            "asset_type": asset_type,
            "rows_synced": len(synced_df),
            "requested_start": payload.start_date,
            "requested_end": payload.end_date,
            "local_rows": summary["count"],
            "local_start": summary["start"],
            "local_end": summary["end"],
        },
        "meta": {
            "source": synced_meta.get("source"),
            "stale": synced_meta.get("stale"),
            "as_of": synced_meta.get("as_of"),
            "provider": synced_meta.get("provider"),
            "fetch_source": synced_meta.get("fetch_source"),
        },
    }


@router.get("/{symbol}/kline")
async def get_kline(
    symbol: str,
    period: str = Query("1d", pattern="^(1d|1W|1M)$"),
    start: str | None = Query(None),
    end: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get Kline data from local storage first, then sync missing daily coverage."""
    if not end:
        end = date.today().strftime("%Y-%m-%d")
    if not start:
        start = (date.today() - timedelta(days=120)).strftime("%Y-%m-%d")
    _validate_date_range(start, end)

    normalized_symbol = symbol.upper()
    asset_type, _ = detect_provider(normalized_symbol)

    latest_df, latest_meta = await load_ohlcv_window(
        db=db,
        symbol=normalized_symbol,
        asset_type=asset_type,
        start_date=start,
        end_date=end,
        interval="1d",
        prefer_local=True,
        sync_if_missing=True,
    )
    if latest_df.empty:
        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest kline data", {"symbol": normalized_symbol}),
        )

    chart_df = _resample_ohlcv(latest_df, period)
    data = [
        {
            "time": row.time.isoformat(),
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
        }
        for row in chart_df.itertuples(index=False)
    ]

    return {
        "data": data,
        "meta": {
            "symbol": normalized_symbol,
            "period": period,
            "start": start,
            "end": end,
            "asset_type": asset_type,
            "source": latest_meta.get("source"),
            "stale": latest_meta.get("stale"),
            "as_of": latest_meta.get("as_of"),
            "provider": latest_meta.get("provider"),
            "fetch_source": latest_meta.get("fetch_source"),
            "sync_performed": latest_meta.get("sync_performed"),
            "coverage_complete": latest_meta.get("coverage_complete"),
            "count": len(data),
            "local_history_synced": bool(latest_meta.get("sync_performed")),
        },
    }


@router.get("/{symbol}/quote")
async def get_quote(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Get latest quote for stock/crypto symbol with unified metadata."""
    normalized_symbol = symbol.upper()
    asset_type, _ = detect_provider(normalized_symbol)
    as_of = _utc_now_iso()

    if asset_type == "crypto":
        quote = _fetch_crypto_quote_live(normalized_symbol)
        if isinstance(quote, dict):
            normalized_quote = {
                "symbol": normalized_symbol,
                "asset_type": "crypto",
                "price": float(quote.get("price") or 0),
                "change_pct_24h": float(quote.get("change_pct_24h") or 0),
                "source": "live",
                "as_of": as_of,
            }
            _write_crypto_quote_cache(normalized_symbol, normalized_quote)
            return {
                "data": normalized_quote,
                "meta": {
                    "source": "live",
                    "stale": False,
                    "as_of": as_of,
                    "provider": "coingecko",
                    "fetch_source": "coingecko",
                    "cache_age_sec": 0,
                },
            }

        cached_quote, stale = _read_crypto_quote_cache(normalized_symbol, allow_stale=True)
        if isinstance(cached_quote, dict) and cached_quote.get("price") is not None:
            cached_as_of = str(cached_quote.get("as_of") or "")
            return {
                "data": {
                    "symbol": normalized_symbol,
                    "asset_type": "crypto",
                    "price": float(cached_quote.get("price") or 0),
                    "change_pct_24h": float(cached_quote.get("change_pct_24h") or 0),
                    "source": "cache",
                    "as_of": cached_as_of or as_of,
                },
                "meta": {
                    "source": "cache",
                    "stale": stale,
                    "as_of": cached_as_of or as_of,
                    "provider": "coingecko",
                    "fetch_source": "cache_fallback",
                    "cache_age_sec": _cache_age_seconds(cached_as_of),
                },
            }

        # Last fallback for first-hit 429 scenarios: derive quote from latest daily close.
        fallback_df, fallback_meta = fetch_ohlcv_with_meta(
            symbol=normalized_symbol,
            start_date=(date.today() - timedelta(days=10)).strftime("%Y-%m-%d"),
            end_date=date.today().strftime("%Y-%m-%d"),
            interval="1d",
        )
        if not fallback_df.empty:
            latest = float(fallback_df.iloc[-1]["close"])
            prev = float(fallback_df.iloc[-2]["close"]) if len(fallback_df) > 1 else latest
            change_pct = ((latest - prev) / prev * 100) if prev else 0
            fallback_as_of = fallback_df.iloc[-1]["time"].isoformat()
            fallback_quote = {
                "symbol": normalized_symbol,
                "asset_type": "crypto",
                "price": latest,
                "change_pct_24h": round(change_pct, 4),
                "source": fallback_meta.get("source") or "live",
                "as_of": fallback_as_of,
            }
            _write_crypto_quote_cache(normalized_symbol, fallback_quote)
            return {
                "data": fallback_quote,
                "meta": {
                    "source": fallback_meta.get("source") or "live",
                    "stale": bool(fallback_meta.get("stale")),
                    "as_of": fallback_meta.get("as_of") or fallback_as_of,
                    "provider": fallback_meta.get("provider"),
                    "fetch_source": "ohlcv_fallback",
                    "cache_age_sec": 0,
                },
            }

        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Unable to fetch realtime price", {"symbol": normalized_symbol}),
        )

    latest_df, latest_meta = await _load_stock_quote_frame(
        db=db,
        symbol=normalized_symbol,
        end_date=date.today().strftime("%Y-%m-%d"),
    )
    if latest_df.empty:
        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest quote data", {"symbol": normalized_symbol}),
        )

    latest = float(latest_df.iloc[-1]["close"])
    prev = float(latest_df.iloc[-2]["close"]) if len(latest_df) > 1 else latest
    change_pct = ((latest - prev) / prev * 100) if prev else 0
    as_of = latest_df.iloc[-1]["time"].isoformat()

    return {
        "data": {
            "symbol": normalized_symbol,
            "asset_type": "stock",
            "price": latest,
            "change_pct_24h": round(change_pct, 4),
            "source": latest_meta.get("source"),
            "as_of": as_of,
        },
        "meta": {
            "source": latest_meta.get("source"),
            "stale": latest_meta.get("stale"),
            "as_of": latest_meta.get("as_of") or as_of,
            "provider": latest_meta.get("provider"),
            "fetch_source": latest_meta.get("fetch_source"),
            "sync_performed": latest_meta.get("sync_performed"),
            "coverage_complete": latest_meta.get("coverage_complete"),
        },
    }


@router.get("/{symbol}/realtime")
async def get_realtime(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Backward-compatible alias for quote endpoint."""
    return await get_quote(symbol=symbol, db=db)


@router.get("/{symbol}/summary")
async def get_summary(symbol: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Fetch quote and local history status together for the workspace overview."""
    normalized_symbol = symbol.upper()
    asset_type, _ = detect_provider(normalized_symbol)
    history_data, history_meta = await _build_history_status_payload(db, normalized_symbol, asset_type)

    quote_data: dict[str, Any] | None = None
    quote_meta: dict[str, Any] | None = None
    quote_error: str | None = None
    try:
        quote_resp = await get_quote(symbol=normalized_symbol, db=db)
        quote_data = quote_resp.get("data") or None
        quote_meta = quote_resp.get("meta") or None
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        error_block = detail.get("error", {}) if isinstance(detail, dict) else {}
        quote_error = error_block.get("message") if isinstance(error_block, dict) else None

    return {
        "data": {
            "symbol": normalized_symbol,
            "asset_type": asset_type,
            "quote": quote_data,
            "history_status": history_data,
        },
        "meta": {
            "quote": quote_meta,
            "history_status": history_meta,
            "quote_error": quote_error,
        },
    }


@router.post("/quotes")
async def get_quotes(payload: BatchQuoteRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Fetch multiple symbol quotes in one request to reduce frontend chattiness."""
    normalized_symbols: list[str] = []
    seen: set[str] = set()
    for raw in payload.symbols:
        symbol = str(raw or "").upper().strip()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        normalized_symbols.append(symbol)

    if not normalized_symbols:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_SYMBOLS", "symbols must include at least one valid symbol", {}),
        )

    rows: list[dict[str, Any]] = []
    failed_symbols: list[str] = []
    for symbol in normalized_symbols:
        asset_type, _ = detect_provider(symbol)
        try:
            resp = await get_quote(symbol=symbol, db=db)
            quote_data = resp.get("data") or {}
            quote_meta = resp.get("meta") or {}
            rows.append(
                {
                    "symbol": symbol,
                    "asset_type": quote_data.get("asset_type", asset_type),
                    "price": quote_data.get("price"),
                    "change_pct_24h": quote_data.get("change_pct_24h"),
                    "as_of": quote_data.get("as_of"),
                    "source": quote_meta.get("source") or quote_data.get("source"),
                    "fetch_source": quote_meta.get("fetch_source"),
                    "stale": quote_meta.get("stale"),
                    "error": None,
                }
            )
        except HTTPException as exc:
            failed_symbols.append(symbol)
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            error_message = detail.get("error", {}).get("message") if isinstance(detail, dict) else None
            rows.append(
                {
                    "symbol": symbol,
                    "asset_type": asset_type,
                    "price": None,
                    "change_pct_24h": None,
                    "as_of": None,
                    "source": None,
                    "fetch_source": None,
                    "stale": None,
                    "error": error_message or "加载报价失败",
                }
            )

    return {
        "data": rows,
        "meta": {
            "count": len(rows),
            "success_count": len(rows) - len(failed_symbols),
            "failed_count": len(failed_symbols),
            "failed_symbols": failed_symbols,
        },
    }


@router.get("/top-movers")
async def top_movers(
    type: str = Query("stock", pattern="^(stock|crypto)$"),
    limit: int = Query(10, ge=1, le=50),
    force_refresh: bool = Query(False),
    allow_stale: bool = Query(False),
) -> dict[str, Any]:
    """Return top movers from live upstream feeds."""
    if type == "stock":
        snapshot, snapshot_meta = fetch_stock_snapshot_with_meta(
            market="all",
            limit=max(limit * 3, 60),
            force_refresh=force_refresh,
            allow_stale=allow_stale,
        )
        if not snapshot:
            raise HTTPException(
                status_code=502,
                detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest stock movers", {}),
            )
        stock_rows = [row for row in snapshot if row.get("change_pct") is not None and row.get("last_price") is not None]
        stock_rows.sort(key=lambda r: float(r["change_pct"]), reverse=True)
        data = [
            {
                "symbol": str(row["symbol"]).upper(),
                "change_pct": round(float(row["change_pct"]), 4),
                "latest": float(row["last_price"]),
            }
            for row in stock_rows[:limit]
        ]
        return {
            "data": data,
            "meta": {
                "count": len(data),
                "type": type,
                "source": snapshot_meta.get("source"),
                "stale": snapshot_meta.get("stale"),
                "as_of": snapshot_meta.get("as_of"),
                "cache_age_sec": snapshot_meta.get("cache_age_sec"),
                "refresh_in_progress": False,
            },
        }

    tracked = ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "DOGE", "DOT"]
    quotes = fetch_crypto_realtime_price(tracked)
    if not quotes:
        raise HTTPException(
            status_code=502,
            detail=_error("UPSTREAM_UNAVAILABLE", "Failed to fetch latest crypto movers", {}),
        )
    data = [
        {
            "symbol": symbol,
            "change_pct": round(float(item.get("change_pct_24h", 0) or 0), 4),
            "latest": float(item.get("price", 0) or 0),
        }
        for symbol, item in quotes.items()
    ]
    data.sort(key=lambda r: r["change_pct"], reverse=True)

    return {
        "data": data[:limit],
        "meta": {
            "count": min(len(data), limit),
            "type": type,
            "source": "live",
            "stale": False,
            "as_of": None,
            "cache_age_sec": None,
            "refresh_in_progress": False,
        },
    }
