"""Backtest API routes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.openbb_adapter import fetch_ohlcv
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


@router.post("/run")
async def run_backtest(payload: BacktestRequest) -> dict[str, Any]:
    """Run strategy backtest and return equity curve/trades/metrics."""
    try:
        strategy = _build_strategy(payload.strategy_name, payload.parameters)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_STRATEGY_PARAMS", str(exc), {"strategy": payload.strategy_name}),
        ) from exc

    df = fetch_ohlcv(
        symbol=payload.symbol.upper(),
        start_date=payload.start_date,
        end_date=payload.end_date,
        interval="1d",
    )
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No kline data for backtest", {"symbol": payload.symbol.upper()}),
        )

    engine = BacktestEngine(strategy=strategy, initial_capital=payload.initial_capital)
    result = engine.run(df=df, symbol=payload.symbol.upper(), asset_type=payload.asset_type)
    return {"data": result}
