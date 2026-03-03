"""Backtest API routes."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.openbb_adapter import (
    fetch_ohlcv,
    fetch_stock_snapshot_with_meta,
    fetch_stock_universe_total_with_meta,
)
from backtest.engine import BacktestEngine
from backtest.strategies.ma_cross import MACrossStrategy
from backtest.strategies.macd_signal import MACDSignalStrategy
from backtest.strategies.rsi_reversal import RSIReversalStrategy

router = APIRouter()


class BacktestRequest(BaseModel):
    """Backtest execution request payload."""

    symbol: str
    asset_type: str = Field(..., pattern="^(stock|crypto)$")
    strategy_name: str = Field(..., pattern="^(ma_cross|macd_signal|rsi_reversal)$")
    parameters: dict[str, Any] = Field(default_factory=dict)
    start_date: str
    end_date: str
    initial_capital: float = Field(1_000_000, gt=0)


class BacktestLabRequest(BaseModel):
    """Batch backtest request for market-wide stock universe."""

    market: Literal["us", "cn"] = "us"
    strategy_name: str = Field(..., pattern="^(ma_cross|macd_signal|rsi_reversal)$")
    parameters: dict[str, Any] = Field(default_factory=dict)
    start_date: str
    end_date: str
    initial_capital: float = Field(1_000_000, gt=0)
    symbol_limit: int = Field(20000, ge=50, le=20000)
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=50, le=50)
    force_refresh: bool = True
    allow_stale: bool = False


def _error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details or {}},
        "request_id": "",
    }


def _build_strategy(name: str, params: dict[str, Any]):
    if name == "ma_cross":
        return MACrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20)))
    if name == "macd_signal":
        return MACDSignalStrategy()
    if name == "rsi_reversal":
        return RSIReversalStrategy(
            period=int(params.get("period", 14)),
            oversold=float(params.get("oversold", 30)),
            overbought=float(params.get("overbought", 70)),
        )
    raise ValueError(f"unsupported strategy: {name}")


def _build_backtest_summary(symbol: str, name: str, market: str, metrics: dict[str, Any]) -> dict[str, Any]:
    """Map full backtest metrics into lightweight table row."""
    return {
        "symbol": symbol,
        "name": name,
        "market": market,
        "total_return": float(metrics.get("total_return", 0) or 0),
        "annual_return": float(metrics.get("annual_return", 0) or 0),
        "sharpe_ratio": float(metrics.get("sharpe_ratio", 0) or 0),
        "max_drawdown": float(metrics.get("max_drawdown", 0) or 0),
        "win_rate": float(metrics.get("win_rate", 0) or 0),
        "trade_count": int(metrics.get("trade_count", 0) or 0),
    }


async def _upsert_ohlcv_rows(
    db: AsyncSession | None,
    symbol: str,
    asset_type: str,
    rows: list[dict[str, Any]],
) -> None:
    """Persist latest live OHLCV rows for reproducibility."""
    if db is None or not rows:
        return
    insert_stmt = text(
        """
        INSERT INTO ohlcv_daily(time, symbol, asset_type, open, high, low, close, volume)
        VALUES (:time, :symbol, :asset_type, :open, :high, :low, :close, :volume)
        ON CONFLICT (time, symbol, asset_type) DO UPDATE SET
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume
        """
    )
    await db.execute(insert_stmt, rows)
    await db.commit()


async def _fetch_ohlcv_live(
    db: AsyncSession | None,
    symbol: str,
    asset_type: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Fetch live OHLCV and persist locally for reproducibility."""
    latest_df = fetch_ohlcv(
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
        interval="1d",
    )
    if not latest_df.empty:
        payload = [
            {
                "time": row.time.to_pydatetime(),
                "symbol": symbol,
                "asset_type": asset_type,
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
                "volume": float(row.volume),
            }
            for row in latest_df.itertuples(index=False)
        ]
        await _upsert_ohlcv_rows(db, symbol, asset_type, payload)
    return latest_df


@router.post("/run")
async def run_backtest(payload: BacktestRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Run strategy backtest and return equity curve/trades/metrics."""
    try:
        strategy = _build_strategy(payload.strategy_name, payload.parameters)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_STRATEGY_PARAMS", str(exc), {"strategy": payload.strategy_name}),
        ) from exc

    symbol = payload.symbol.upper()
    db_session = db if isinstance(db, AsyncSession) else None
    df = await _fetch_ohlcv_live(
        db=db_session,
        symbol=symbol,
        asset_type=payload.asset_type,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No kline data for backtest", {"symbol": symbol}),
        )

    engine = BacktestEngine(strategy=strategy, initial_capital=payload.initial_capital)
    result = engine.run(df=df, symbol=symbol, asset_type=payload.asset_type)
    return {"data": result, "meta": {"ohlcv_source": "live", "stale": False}}


@router.post("/lab")
async def run_backtest_lab(payload: BacktestLabRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Run batch backtest over latest market stock universe with pagination."""
    try:
        strategy = _build_strategy(payload.strategy_name, payload.parameters)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_STRATEGY_PARAMS", str(exc), {"strategy": payload.strategy_name}),
        ) from exc

    snapshot, snapshot_meta = fetch_stock_snapshot_with_meta(
        market=payload.market,
        limit=payload.symbol_limit,
        force_refresh=payload.force_refresh,
        allow_stale=payload.allow_stale,
    )
    if not snapshot:
        raise HTTPException(
            status_code=502,
            detail=_error(
                "UPSTREAM_UNAVAILABLE",
                "Failed to fetch latest stock snapshot for backtest lab",
                {"market": payload.market},
            ),
        )

    engine = BacktestEngine(strategy=strategy, initial_capital=payload.initial_capital)
    db_session = db if isinstance(db, AsyncSession) else None
    ranked_rows: list[dict[str, Any]] = []
    live_ohlcv_symbols = 0
    failed_ohlcv_symbols = 0

    for item in snapshot:
        symbol = str(item.get("symbol", "")).upper()
        if not symbol:
            continue

        df = await _fetch_ohlcv_live(
            db=db_session,
            symbol=symbol,
            asset_type="stock",
            start_date=payload.start_date,
            end_date=payload.end_date,
        )
        if df.empty:
            failed_ohlcv_symbols += 1
            continue
        live_ohlcv_symbols += 1

        try:
            result = engine.run(df=df, symbol=symbol, asset_type="stock")
            ranked_rows.append(
                _build_backtest_summary(
                    symbol=symbol,
                    name=str(item.get("name") or symbol),
                    market=str(item.get("market") or payload.market).upper(),
                    metrics=result.get("metrics", {}),
                )
            )
        except Exception:
            continue

    ranked_rows.sort(key=lambda row: row["total_return"], reverse=True)

    total_items = len(ranked_rows)
    total_pages = max(1, (total_items + payload.page_size - 1) // payload.page_size)
    page = min(payload.page, total_pages)
    start_idx = (page - 1) * payload.page_size
    end_idx = start_idx + payload.page_size
    page_rows = ranked_rows[start_idx:end_idx]
    total_available, total_meta = fetch_stock_universe_total_with_meta(
        payload.market,
        force_refresh=payload.force_refresh,
        allow_stale=payload.allow_stale,
    )

    return {
        "data": page_rows,
        "meta": {
            "count": len(page_rows),
            "total_items": total_items,
            "total_pages": total_pages,
            "page": page,
            "page_size": payload.page_size,
            "market": payload.market,
            "symbols_fetched": len(snapshot),
            "symbols_backtested": len(ranked_rows),
            "total_available": total_available,
            "source": snapshot_meta.get("source"),
            "stale": bool(snapshot_meta.get("stale")) or bool(total_meta.get("stale")),
            "as_of": snapshot_meta.get("as_of"),
            "cache_age_sec": snapshot_meta.get("cache_age_sec"),
            "ohlcv_live_symbols": live_ohlcv_symbols,
            "ohlcv_failed_symbols": failed_ohlcv_symbols,
            "ohlcv_local_fallback_symbols": 0,
        },
    }
