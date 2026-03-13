"""Factor-scoring API routes."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.factor_engine import normalize_factor, score_factors
from app.services.ohlcv_store import load_ohlcv_window
from app.services.openbb_adapter import (
    fetch_stock_snapshot_with_meta,
    fetch_stock_universe_total_with_meta,
)

router = APIRouter()

DEFAULT_FACTOR_BACKTEST_CACHE_TTL_SECONDS = 15 * 60


class FactorWeights(BaseModel):
    """Four-factor weight configuration."""

    value: float = Field(25, ge=0, le=100)
    growth: float = Field(25, ge=0, le=100)
    momentum: float = Field(25, ge=0, le=100)
    quality: float = Field(25, ge=0, le=100)


class FactorScoreRequest(BaseModel):
    """Request schema for factor scoring."""

    weights: FactorWeights
    market: Literal["us", "cn"] = "us"
    symbol_limit: int = Field(20000, ge=50, le=20000)
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=50, le=50)
    force_refresh: bool = True
    allow_stale: bool = False


class FactorBacktestRequest(BaseModel):
    """History factor backtest request schema."""

    weights: FactorWeights
    market: Literal["us", "cn"] = "us"
    start_date: str
    end_date: str
    rebalance: Literal["M", "W"] = "M"
    top_n: int = Field(20, ge=5, le=200)
    symbol_limit: int = Field(200, ge=20, le=1000)
    initial_capital: float = Field(1_000_000, gt=0)
    force_refresh: bool = True
    allow_stale: bool = False
    cache_ttl_seconds: int = Field(DEFAULT_FACTOR_BACKTEST_CACHE_TTL_SECONDS, ge=60, le=24 * 3600)


def _error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details or {}},
        "request_id": "",
    }


def _weights_dict(weights: FactorWeights) -> dict[str, float]:
    return weights.model_dump()


def _validate_weights(weights: dict[str, float]) -> None:
    if round(sum(weights.values()), 6) != 100.0:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_WEIGHTS", "weights must sum to 100", {"weights": weights}),
        )


def _parse_ymd(value: str, field_name: str) -> pd.Timestamp:
    try:
        ts = pd.to_datetime(value, utc=True)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_DATE", f"Invalid {field_name}", {field_name: value}),
        ) from exc
    if pd.isna(ts):
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_DATE", f"Invalid {field_name}", {field_name: value}),
        )
    return ts


def _snapshot_universe(
    market: Literal["us", "cn"],
    symbol_limit: int,
    *,
    force_refresh: bool,
    allow_stale: bool,
) -> tuple[pd.DataFrame, int, dict[str, Any], list[dict[str, Any]]]:
    """Build dynamic factor universe from latest market snapshot."""
    rows, snapshot_meta = fetch_stock_snapshot_with_meta(
        market=market,
        limit=symbol_limit,
        force_refresh=force_refresh,
        allow_stale=allow_stale,
    )
    if not rows:
        return pd.DataFrame(), 0, snapshot_meta, []

    normalized: list[dict[str, Any]] = []
    seen_symbols: set[str] = set()

    for row in rows:
        symbol = str(row.get("symbol", "")).upper()
        if not symbol or symbol in seen_symbols:
            continue

        pe = row.get("pe_ttm")
        roe = row.get("roe")
        growth = row.get("profit_yoy")
        momentum = row.get("change_pct")

        if pe is None or roe is None or growth is None:
            continue
        if momentum is None:
            momentum = 0

        normalized.append(
            {
                "symbol": symbol,
                "name": row.get("name") or symbol,
                "pe_ttm": float(pe),
                "profit_yoy": float(growth),
                # Snapshot provides current change pct, used as short-term momentum proxy.
                "momentum_20d": float(momentum),
                "roe": float(roe),
            }
        )
        seen_symbols.add(symbol)

    return pd.DataFrame(normalized), len(rows), snapshot_meta, rows


def _to_points(series: pd.Series) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for idx, value in series.items():
        points.append({"date": idx.date().isoformat(), "value": round(float(value), 4)})
    return points


def _calc_curve_metrics(curve: pd.Series, daily_returns: pd.Series, initial_capital: float) -> dict[str, float]:
    if curve.empty:
        return {
            "total_return": 0.0,
            "annual_return": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown": 0.0,
            "win_rate": 0.0,
            "volatility": 0.0,
            "initial_capital": initial_capital,
            "final_value": initial_capital,
        }

    total_return = float(curve.iloc[-1] / initial_capital - 1.0)
    n_days = max(1, len(daily_returns))
    annual_return = float((1.0 + total_return) ** (252 / n_days) - 1.0) if n_days > 0 else 0.0

    daily_std = float(daily_returns.std(ddof=0))
    daily_mean = float(daily_returns.mean())
    volatility = daily_std * (252**0.5)
    sharpe = (daily_mean * 252 / volatility) if volatility > 0 else 0.0

    running_max = curve.cummax()
    drawdown = curve / running_max - 1.0
    max_drawdown = float(drawdown.min()) if not drawdown.empty else 0.0
    win_rate = float((daily_returns > 0).sum() / n_days)

    return {
        "total_return": round(total_return * 100, 4),
        "annual_return": round(annual_return * 100, 4),
        "sharpe_ratio": round(sharpe, 4),
        "max_drawdown": round(max_drawdown * 100, 4),
        "win_rate": round(win_rate * 100, 4),
        "volatility": round(volatility * 100, 4),
        "initial_capital": float(initial_capital),
        "final_value": round(float(curve.iloc[-1]), 2),
    }


def _build_rebalance_dates(index: pd.DatetimeIndex, rebalance: Literal["M", "W"]) -> list[pd.Timestamp]:
    if index.empty:
        return []
    out: list[pd.Timestamp] = []
    seen: set[pd.Period] = set()
    freq = "M" if rebalance == "M" else "W"
    for ts in index:
        normalized_ts = ts.tz_convert("UTC").tz_localize(None) if ts.tzinfo is not None else ts
        period = normalized_ts.to_period(freq)
        if period in seen:
            continue
        seen.add(period)
        out.append(ts)
    return out


def _cache_key(payload: FactorBacktestRequest) -> str:
    body = {
        "v": 1,
        "market": payload.market,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "rebalance": payload.rebalance,
        "top_n": payload.top_n,
        "symbol_limit": payload.symbol_limit,
        "initial_capital": payload.initial_capital,
        "weights": payload.weights.model_dump(),
    }
    encoded = json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return sha256(encoded).hexdigest()


async def _ensure_local_cache_tables(db: AsyncSession) -> None:
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS market_snapshot_daily (
              trade_date DATE NOT NULL,
              market VARCHAR(10) NOT NULL,
              symbol VARCHAR(30) NOT NULL,
              payload JSONB NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (trade_date, market, symbol)
            )
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_market_snapshot_daily_market_date
            ON market_snapshot_daily(market, trade_date DESC)
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS backtest_cache (
              cache_key VARCHAR(128) PRIMARY KEY,
              category VARCHAR(40) NOT NULL,
              request_payload JSONB NOT NULL,
              response_payload JSONB NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              expires_at TIMESTAMPTZ NOT NULL
            )
            """
        )
    )
    await db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS idx_backtest_cache_expires_at
            ON backtest_cache(expires_at)
            """
        )
    )
    await db.commit()


async def _persist_snapshot_daily(
    db: AsyncSession,
    market: Literal["us", "cn"],
    raw_rows: list[dict[str, Any]],
    as_of: str | None,
) -> None:
    if not raw_rows:
        return

    if as_of:
        trade_date = pd.to_datetime(as_of, utc=True).date()
    else:
        trade_date = datetime.now(timezone.utc).date()

    await _ensure_local_cache_tables(db)
    stmt = text(
        """
        INSERT INTO market_snapshot_daily(trade_date, market, symbol, payload)
        VALUES (:trade_date, :market, :symbol, CAST(:payload AS JSONB))
        ON CONFLICT (trade_date, market, symbol) DO UPDATE SET
          payload = EXCLUDED.payload,
          created_at = NOW()
        """
    )
    rows = [
        {
            "trade_date": trade_date,
            "market": market.upper(),
            "symbol": str(item.get("symbol", "")).upper(),
            "payload": json.dumps(item, ensure_ascii=False),
        }
        for item in raw_rows
        if item.get("symbol")
    ]
    if not rows:
        return
    await db.execute(stmt, rows)
    await db.commit()


async def _read_cache(db: AsyncSession, cache_key: str) -> dict[str, Any] | None:
    await _ensure_local_cache_tables(db)
    result = await db.execute(
        text(
            """
            SELECT response_payload
            FROM backtest_cache
            WHERE cache_key = :cache_key
              AND expires_at > NOW()
            LIMIT 1
            """
        ),
        {"cache_key": cache_key},
    )
    row = result.fetchone()
    if row is None:
        return None
    payload = row.response_payload
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            parsed = json.loads(payload)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


async def _write_cache(
    db: AsyncSession,
    cache_key: str,
    category: str,
    request_payload: dict[str, Any],
    response_payload: dict[str, Any],
    ttl_seconds: int,
) -> None:
    await _ensure_local_cache_tables(db)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(1, ttl_seconds))
    await db.execute(
        text(
            """
            INSERT INTO backtest_cache(cache_key, category, request_payload, response_payload, expires_at)
            VALUES (:cache_key, :category, CAST(:request_payload AS JSONB), CAST(:response_payload AS JSONB), :expires_at)
            ON CONFLICT (cache_key) DO UPDATE SET
              category = EXCLUDED.category,
              request_payload = EXCLUDED.request_payload,
              response_payload = EXCLUDED.response_payload,
              expires_at = EXCLUDED.expires_at,
              created_at = NOW()
            """
        ),
        {
            "cache_key": cache_key,
            "category": category,
            "request_payload": json.dumps(request_payload, ensure_ascii=False),
            "response_payload": json.dumps(response_payload, ensure_ascii=False),
            "expires_at": expires_at,
        },
    )
    await db.commit()


async def _load_symbol_ohlcv(
    db: AsyncSession | None,
    symbol: str,
    start_ts: pd.Timestamp,
    end_ts: pd.Timestamp,
) -> tuple[pd.DataFrame, str]:
    frame, meta = await load_ohlcv_window(
        db=db if isinstance(db, AsyncSession) else None,
        symbol=symbol,
        asset_type="stock",
        start_date=start_ts.strftime("%Y-%m-%d"),
        end_date=end_ts.strftime("%Y-%m-%d"),
        interval="1d",
    )
    if meta.get("source") == "local" and not bool(meta.get("sync_performed")):
        return frame, "local"
    return frame, "live"


@router.post("/score")
async def factors_score(
    payload: FactorScoreRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Calculate weighted stock factor ranking."""
    weights = _weights_dict(payload.weights)
    _validate_weights(weights)

    df, snapshot_count, snapshot_meta, raw_rows = _snapshot_universe(
        payload.market,
        payload.symbol_limit,
        force_refresh=payload.force_refresh,
        allow_stale=payload.allow_stale,
    )
    if snapshot_count == 0:
        raise HTTPException(
            status_code=502,
            detail=_error(
                "UPSTREAM_UNAVAILABLE",
                "Failed to fetch latest stock snapshot for factor scoring",
                {"market": payload.market},
            ),
        )

    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No usable live stock universe for factor scoring", {"market": payload.market}),
        )

    if isinstance(db, AsyncSession):
        await _persist_snapshot_daily(db, payload.market, raw_rows, snapshot_meta.get("as_of"))

    ranked_all = score_factors(df, weights=weights, top_n=len(df))
    total_items = len(ranked_all)
    total_pages = max(1, (total_items + payload.page_size - 1) // payload.page_size)
    page = min(payload.page, total_pages)
    start_idx = (page - 1) * payload.page_size
    end_idx = start_idx + payload.page_size
    data = ranked_all.iloc[start_idx:end_idx].to_dict("records")

    total_available, total_meta = fetch_stock_universe_total_with_meta(
        payload.market,
        force_refresh=payload.force_refresh,
        allow_stale=payload.allow_stale,
    )

    return {
        "data": data,
        "meta": {
            "count": len(data),
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "page_size": payload.page_size,
            "market": payload.market,
            "symbols_fetched": snapshot_count,
            "total_available": total_available,
            "source": snapshot_meta.get("source"),
            "stale": bool(snapshot_meta.get("stale")) or bool(total_meta.get("stale")),
            "as_of": snapshot_meta.get("as_of"),
            "cache_age_sec": snapshot_meta.get("cache_age_sec"),
            "refresh_in_progress": False,
        },
    }


@router.post("/backtest")
async def factors_backtest(
    payload: FactorBacktestRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Run history factor backtest with periodic rebalancing."""
    weights = _weights_dict(payload.weights)
    _validate_weights(weights)

    start_ts = _parse_ymd(payload.start_date, "start_date")
    end_ts = _parse_ymd(payload.end_date, "end_date")
    if start_ts >= end_ts:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_DATE_RANGE", "start_date must be earlier than end_date", {}),
        )

    cache_hit = False
    if isinstance(db, AsyncSession):
        key = _cache_key(payload)
        cached = await _read_cache(db, key)
        if isinstance(cached, dict):
            cache_hit = True
            cached.setdefault("meta", {})
            cached["meta"]["cache_hit"] = True
            return cached

    df, snapshot_count, snapshot_meta, raw_rows = _snapshot_universe(
        payload.market,
        payload.symbol_limit,
        force_refresh=payload.force_refresh,
        allow_stale=payload.allow_stale,
    )
    if snapshot_count == 0:
        raise HTTPException(
            status_code=502,
            detail=_error(
                "UPSTREAM_UNAVAILABLE",
                "Failed to fetch latest stock snapshot for factor backtest",
                {"market": payload.market},
            ),
        )
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No usable live stock universe for factor backtest", {"market": payload.market}),
        )

    if isinstance(db, AsyncSession):
        await _persist_snapshot_daily(db, payload.market, raw_rows, snapshot_meta.get("as_of"))

    base = df.set_index("symbol")
    base["value_score"] = normalize_factor(base["pe_ttm"], reverse=True)
    base["growth_score"] = normalize_factor(base["profit_yoy"])
    base["quality_score"] = normalize_factor(base["roe"])

    prices_by_symbol: dict[str, pd.Series] = {}
    local_symbols = 0
    live_symbols = 0
    for symbol in base.index.tolist():
        hist_df, source = await _load_symbol_ohlcv(db if isinstance(db, AsyncSession) else None, symbol, start_ts, end_ts)
        if hist_df.empty:
            continue
        close_series = hist_df.set_index("time")["close"].astype(float).sort_index()
        close_series = close_series[~close_series.index.duplicated(keep="last")]
        close_series = close_series[(close_series.index >= start_ts) & (close_series.index <= end_ts)]
        if len(close_series) < 40:
            continue
        prices_by_symbol[symbol] = close_series
        if source == "local":
            local_symbols += 1
        else:
            live_symbols += 1

    if not prices_by_symbol:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No OHLCV data available for factor backtest", {"market": payload.market}),
        )

    prices = pd.DataFrame(prices_by_symbol).sort_index()
    prices = prices[(prices.index >= start_ts) & (prices.index <= end_ts)]
    if prices.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No overlapping OHLCV range for factor backtest", {}),
        )

    returns = prices.pct_change().replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
    benchmark_returns = returns.mean(axis=1, skipna=True).fillna(0.0)
    rebalance_dates = _build_rebalance_dates(returns.index, payload.rebalance)

    allocations: list[tuple[pd.Timestamp, list[str]]] = []
    for rebalance_dt in rebalance_dates:
        hist_prices = prices.loc[:rebalance_dt]
        if len(hist_prices) <= 20:
            continue

        momentum = (hist_prices.iloc[-1] / hist_prices.iloc[-21] - 1.0) * 100
        momentum_score = normalize_factor(momentum).rename("momentum_score")
        ranked = base.join(momentum_score, how="inner")
        ranked["total_score"] = (
            ranked["value_score"] * weights["value"] / 100
            + ranked["growth_score"] * weights["growth"] / 100
            + ranked["momentum_score"] * weights["momentum"] / 100
            + ranked["quality_score"] * weights["quality"] / 100
        )
        ranked = ranked.sort_values("total_score", ascending=False)
        symbols = [sym for sym in ranked.index.tolist() if sym in returns.columns][: payload.top_n]
        if symbols:
            allocations.append((rebalance_dt, symbols))

    if not allocations:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No valid rebalance windows for factor backtest", {}),
        )

    portfolio_returns = pd.Series(0.0, index=returns.index, dtype=float)
    rebalance_history: list[dict[str, Any]] = []
    for idx, (start_dt, symbols) in enumerate(allocations):
        next_dt = allocations[idx + 1][0] if idx + 1 < len(allocations) else None
        if next_dt is None:
            period_returns = returns.loc[returns.index >= start_dt, symbols]
        else:
            period_returns = returns.loc[(returns.index >= start_dt) & (returns.index < next_dt), symbols]
        if period_returns.empty:
            continue
        period_portfolio_ret = period_returns.mean(axis=1, skipna=True).fillna(0.0)
        portfolio_returns.loc[period_portfolio_ret.index] = period_portfolio_ret
        rebalance_history.append(
            {
                "date": start_dt.date().isoformat(),
                "symbols": symbols,
            }
        )

    portfolio_curve = (1.0 + portfolio_returns).cumprod() * payload.initial_capital
    benchmark_curve = (1.0 + benchmark_returns).cumprod() * payload.initial_capital

    turnover_values: list[float] = []
    for idx in range(1, len(allocations)):
        prev_set = set(allocations[idx - 1][1])
        curr_set = set(allocations[idx][1])
        if not curr_set:
            continue
        overlap_ratio = len(prev_set & curr_set) / len(curr_set)
        turnover_values.append(1.0 - overlap_ratio)

    avg_turnover = float(sum(turnover_values) / len(turnover_values)) if turnover_values else 0.0
    response = {
        "data": {
            "equity_curve": _to_points(portfolio_curve),
            "benchmark_curve": _to_points(benchmark_curve),
            "metrics": _calc_curve_metrics(portfolio_curve, portfolio_returns, payload.initial_capital),
            "benchmark_metrics": _calc_curve_metrics(benchmark_curve, benchmark_returns, payload.initial_capital),
            "rebalance_history": rebalance_history,
            "summary": {
                "rebalance_count": len(rebalance_history),
                "top_n": payload.top_n,
                "avg_turnover": round(avg_turnover * 100, 4),
            },
        },
        "meta": {
            "market": payload.market,
            "start_date": payload.start_date,
            "end_date": payload.end_date,
            "rebalance": payload.rebalance,
            "symbols_fetched": snapshot_count,
            "symbols_used": len(prices_by_symbol),
            "source": "mixed" if local_symbols > 0 and live_symbols > 0 else ("cache" if local_symbols > 0 else "live"),
            "stale": bool(snapshot_meta.get("stale")),
            "as_of": snapshot_meta.get("as_of"),
            "cache_age_sec": snapshot_meta.get("cache_age_sec"),
            "cache_hit": cache_hit,
            "ohlcv_live_symbols": live_symbols,
            "ohlcv_local_symbols": local_symbols,
        },
    }

    if isinstance(db, AsyncSession):
        await _write_cache(
            db=db,
            cache_key=_cache_key(payload),
            category="factor_backtest",
            request_payload=payload.model_dump(),
            response_payload=response,
            ttl_seconds=payload.cache_ttl_seconds,
        )

    return response
