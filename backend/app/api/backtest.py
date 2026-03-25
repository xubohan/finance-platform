"""Backtest API routes."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.ohlcv_store import load_ohlcv_window
from app.services.openbb_adapter import fetch_stock_snapshot_with_meta, fetch_stock_universe_total_with_meta
from backtest.engine import BacktestEngine
from backtest.strategies.aroon_trend import AroonTrendStrategy
from backtest.strategies.adx_trend import ADXTrendStrategy
from backtest.strategies.alma_cross import ALMACrossStrategy
from backtest.strategies.awesome_reversal import AwesomeReversalStrategy
from backtest.strategies.bias_reversal import BIASReversalStrategy
from backtest.strategies.bollinger_reversion import BollingerReversionStrategy
from backtest.strategies.buy_hold import BuyHoldStrategy
from backtest.strategies.chaikin_volatility_trend import ChaikinVolatilityTrendStrategy
from backtest.strategies.chaikin_money_flow_trend import ChaikinMoneyFlowTrendStrategy
from backtest.strategies.chaikin_reversal import ChaikinReversalStrategy
from backtest.strategies.cci_reversal import CCIReversalStrategy
from backtest.strategies.cfo_reversal import CFOReversalStrategy
from backtest.strategies.cmo_reversal import CMOReversalStrategy
from backtest.strategies.coppock_trend import CoppockTrendStrategy
from backtest.strategies.dema_cross import DEMACrossStrategy
from backtest.strategies.demarker_reversal import DeMarkerReversalStrategy
from backtest.strategies.dmi_breakout import DMIBreakoutStrategy
from backtest.strategies.donchian_breakout import DonchianBreakoutStrategy
from backtest.strategies.dpo_reversal import DPOReversalStrategy
from backtest.strategies.ema_cross import EMACrossStrategy
from backtest.strategies.efi_trend import EFITrendStrategy
from backtest.strategies.fisher_reversal import FisherReversalStrategy
from backtest.strategies.hma_cross import HMACrossStrategy
from backtest.strategies.atr_breakout import ATRBreakoutStrategy
from backtest.strategies.keltner_reversion import KeltnerReversionStrategy
from backtest.strategies.kst_trend import KSTTrendStrategy
from backtest.strategies.lsma_cross import LSMACrossStrategy
from backtest.strategies.linreg_slope_trend import LinRegSlopeTrendStrategy
from backtest.strategies.ma_cross import MACrossStrategy
from backtest.strategies.macd_signal import MACDSignalStrategy
from backtest.strategies.mcginley_cross import McGinleyCrossStrategy
from backtest.strategies.mfi_reversal import MFIReversalStrategy
from backtest.strategies.obv_trend import OBVTrendStrategy
from backtest.strategies.pmo_trend import PMOTrendStrategy
from backtest.strategies.roc_breakout import ROCBreakoutStrategy
from backtest.strategies.rsi_reversal import RSIReversalStrategy
from backtest.strategies.rvi_reversal import RVIReversalStrategy
from backtest.strategies.schaff_reversal import SchaffReversalStrategy
from backtest.strategies.smma_cross import SMMACrossStrategy
from backtest.strategies.smi_reversal import SMIReversalStrategy
from backtest.strategies.stochrsi_reversal import StochRSIReversalStrategy
from backtest.strategies.stochastic_reversal import StochasticReversalStrategy
from backtest.strategies.supertrend_follow import SupertrendFollowStrategy
from backtest.strategies.t3_cross import T3CrossStrategy
from backtest.strategies.tema_cross import TEMACrossStrategy
from backtest.strategies.trima_cross import TRIMACrossStrategy
from backtest.strategies.trix_trend import TrixTrendStrategy
from backtest.strategies.tsi_trend import TSITrendStrategy
from backtest.strategies.ultimate_oscillator_reversal import UltimateOscillatorReversalStrategy
from backtest.strategies.vwma_cross import VWMACrossStrategy
from backtest.strategies.vwap_reversion import VWAPReversionStrategy
from backtest.strategies.vhf_trend import VHFTrendStrategy
from backtest.strategies.vortex_trend import VortexTrendStrategy
from backtest.strategies.vzo_trend import VZOTrendStrategy
from backtest.strategies.williams_reversal import WilliamsReversalStrategy
from backtest.strategies.wma_cross import WMACrossStrategy
from backtest.strategies.zlema_cross import ZLEMACrossStrategy

router = APIRouter()

SUPPORTED_STRATEGY_NAMES = (
    "ma_cross",
    "ema_cross",
    "alma_cross",
    "lsma_cross",
    "mcginley_cross",
    "t3_cross",
    "trima_cross",
    "smma_cross",
    "vwma_cross",
    "dema_cross",
    "zlema_cross",
    "tema_cross",
    "wma_cross",
    "hma_cross",
    "macd_signal",
    "rsi_reversal",
    "stochastic_reversal",
    "bias_reversal",
    "demarker_reversal",
    "cfo_reversal",
    "smi_reversal",
    "awesome_reversal",
    "schaff_reversal",
    "ultimate_oscillator_reversal",
    "stochrsi_reversal",
    "rvi_reversal",
    "mfi_reversal",
    "cmo_reversal",
    "dpo_reversal",
    "fisher_reversal",
    "buy_hold",
    "bollinger_reversion",
    "donchian_breakout",
    "supertrend_follow",
    "adx_trend",
    "keltner_reversion",
    "vwap_reversion",
    "atr_breakout",
    "cci_reversal",
    "obv_trend",
    "dmi_breakout",
    "chaikin_reversal",
    "williams_reversal",
    "chaikin_money_flow_trend",
    "chaikin_volatility_trend",
    "aroon_trend",
    "efi_trend",
    "vzo_trend",
    "kst_trend",
    "vhf_trend",
    "roc_breakout",
    "linreg_slope_trend",
    "trix_trend",
    "tsi_trend",
    "coppock_trend",
    "vortex_trend",
)
SUPPORTED_STRATEGY_PATTERN = "^(" + "|".join(SUPPORTED_STRATEGY_NAMES) + ")$"

FAST_SLOW_STRATEGIES = {
    "ma_cross",
    "ema_cross",
    "alma_cross",
    "lsma_cross",
    "mcginley_cross",
    "t3_cross",
    "trima_cross",
    "smma_cross",
    "vwma_cross",
    "dema_cross",
    "zlema_cross",
    "tema_cross",
    "wma_cross",
    "hma_cross",
    "obv_trend",
    "chaikin_reversal",
}
OSCILLATOR_STRATEGIES = {
    "rsi_reversal",
    "stochastic_reversal",
    "bias_reversal",
    "demarker_reversal",
    "cfo_reversal",
    "smi_reversal",
    "awesome_reversal",
    "schaff_reversal",
    "ultimate_oscillator_reversal",
    "stochrsi_reversal",
    "rvi_reversal",
    "mfi_reversal",
    "cmo_reversal",
    "dpo_reversal",
    "williams_reversal",
    "fisher_reversal",
}
THRESHOLD_STRATEGIES = {
    "adx_trend",
    "dmi_breakout",
    "chaikin_money_flow_trend",
    "chaikin_volatility_trend",
    "aroon_trend",
    "efi_trend",
    "vzo_trend",
    "vhf_trend",
    "kst_trend",
    "pmo_trend",
    "roc_breakout",
    "linreg_slope_trend",
    "trix_trend",
    "tsi_trend",
    "coppock_trend",
    "vortex_trend",
}
PERIOD_MULTIPLIER_STRATEGIES = {"supertrend_follow", "keltner_reversion"}
TOKEN_LABELS = {
    "adx": "ADX",
    "alma": "ALMA",
    "ao": "AO",
    "aroon": "Aroon",
    "atr": "ATR",
    "awesome": "Awesome",
    "bias": "BIAS",
    "bollinger": "Bollinger",
    "buy": "Buy",
    "cci": "CCI",
    "cfo": "CFO",
    "chaikin": "Chaikin",
    "close": "Close",
    "cmo": "CMO",
    "coppock": "Coppock",
    "cross": "Cross",
    "dema": "DEMA",
    "demarker": "DeMarker",
    "dmi": "DMI",
    "donchian": "Donchian",
    "dpo": "DPO",
    "efi": "EFI",
    "ema": "EMA",
    "factor": "Factor",
    "fast": "Fast",
    "fisher": "Fisher",
    "flow": "Flow",
    "follow": "Follow",
    "hold": "Hold",
    "hma": "HMA",
    "kst": "KST",
    "keltner": "Keltner",
    "linreg": "LinReg",
    "lsma": "LSMA",
    "ma": "MA",
    "macd": "MACD",
    "mcginley": "McGinley",
    "mfi": "MFI",
    "money": "Money",
    "obv": "OBV",
    "oscillator": "Oscillator",
    "pmo": "PMO",
    "pretty": "Pretty",
    "qstick": "QStick",
    "reversal": "Reversal",
    "roc": "ROC",
    "rsi": "RSI",
    "rvi": "RVI",
    "schaff": "Schaff",
    "slope": "Slope",
    "smi": "SMI",
    "smma": "SMMA",
    "stochastic": "Stochastic",
    "stochrsi": "StochRSI",
    "supertrend": "Supertrend",
    "t3": "T3",
    "tema": "TEMA",
    "threshold": "Threshold",
    "trend": "Trend",
    "trima": "TRIMA",
    "trix": "TRIX",
    "tsi": "TSI",
    "ultimate": "Ultimate",
    "vhf": "VHF",
    "vidya": "VIDYA",
    "volatility": "Volatility",
    "volume": "Volume",
    "vortex": "Vortex",
    "vwap": "VWAP",
    "vwma": "VWMA",
    "vzo": "VZO",
    "williams": "Williams",
    "wma": "WMA",
    "zlema": "ZLEMA",
}


class StrategyCatalogEntry(BaseModel):
    """Strategy metadata exposed to the frontend."""

    name: str
    label: str
    parameter_mode: Literal["fast_slow", "oscillator", "threshold", "period_multiplier", "special", "none"]
    summary: str


CompareRankingMetric = Literal[
    "total_return",
    "annual_return",
    "sharpe_ratio",
    "max_drawdown",
    "win_rate",
    "trade_count",
]


class BacktestCompareRequest(BaseModel):
    """Single-asset strategy comparison request."""

    symbol: str
    asset_type: str = Field(..., pattern="^(stock|crypto)$")
    strategy_names: list[str] = Field(..., min_length=1, max_length=8)
    parameters_by_strategy: dict[str, dict[str, Any]] = Field(default_factory=dict)
    start_date: str
    end_date: str
    initial_capital: float = Field(1_000_000, gt=0)
    sync_if_missing: bool = True
    ranking_metric: CompareRankingMetric = "total_return"


class BacktestRequest(BaseModel):
    """Backtest execution request payload."""

    symbol: str
    asset_type: str = Field(..., pattern="^(stock|crypto)$")
    strategy_name: str = Field(..., pattern=SUPPORTED_STRATEGY_PATTERN)
    parameters: dict[str, Any] = Field(default_factory=dict)
    start_date: str
    end_date: str
    initial_capital: float = Field(1_000_000, gt=0)
    sync_if_missing: bool = True


class BacktestLabRequest(BaseModel):
    """Batch backtest request for market-wide stock universe."""

    market: Literal["us", "cn"] = "us"
    symbols: list[str] = Field(default_factory=list, max_length=500)
    strategy_name: str = Field(..., pattern=SUPPORTED_STRATEGY_PATTERN)
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


def _strategy_parameter_mode(name: str) -> Literal["fast_slow", "oscillator", "threshold", "period_multiplier", "special", "none"]:
    if name in FAST_SLOW_STRATEGIES:
        return "fast_slow"
    if name in OSCILLATOR_STRATEGIES:
        return "oscillator"
    if name in THRESHOLD_STRATEGIES:
        return "threshold"
    if name in PERIOD_MULTIPLIER_STRATEGIES:
        return "period_multiplier"
    if name == "buy_hold":
        return "none"
    return "special"


def _strategy_label(name: str) -> str:
    return " ".join(TOKEN_LABELS.get(token, token.title()) for token in name.split("_"))


def _strategy_summary(name: str) -> str:
    if name == "buy_hold":
        return "Buy-and-hold baseline without extra parameters."
    if name.endswith("_cross"):
        return "Fast and slow signal crossover strategy."
    if name.endswith("_reversal"):
        return "Mean-reversion strategy driven by an oscillator or deviation signal."
    if name.endswith("_trend"):
        return "Trend-follow strategy driven by momentum, volatility, or participation."
    if name.endswith("_breakout"):
        return "Breakout strategy that reacts to directional expansion."
    if name.endswith("_follow"):
        return "Trend-follow strategy with confirmation and delayed exit behavior."
    return "Single-asset backtest strategy."


def _strategy_catalog() -> list[StrategyCatalogEntry]:
    return [
        StrategyCatalogEntry(
            name=name,
            label=_strategy_label(name),
            parameter_mode=_strategy_parameter_mode(name),
            summary=_strategy_summary(name),
        )
        for name in SUPPORTED_STRATEGY_NAMES
    ]


def _compare_row(name: str, metrics: dict[str, Any]) -> dict[str, Any]:
    return {
        "strategy_name": name,
        "label": _strategy_label(name),
        "total_return": float(metrics.get("total_return", 0) or 0),
        "annual_return": float(metrics.get("annual_return", 0) or 0),
        "sharpe_ratio": float(metrics.get("sharpe_ratio", 0) or 0),
        "max_drawdown": float(metrics.get("max_drawdown", 0) or 0),
        "win_rate": float(metrics.get("win_rate", 0) or 0),
        "trade_count": int(metrics.get("trade_count", 0) or 0),
    }


def _sort_compare_rows(rows: list[dict[str, Any]], ranking_metric: CompareRankingMetric) -> list[dict[str, Any]]:
    if ranking_metric == "max_drawdown":
        return sorted(rows, key=lambda item: abs(float(item.get("max_drawdown", 0) or 0)))
    return sorted(rows, key=lambda item: float(item.get(ranking_metric, 0) or 0), reverse=True)


StrategyBuilder = Callable[[dict[str, Any]], Any]


STRATEGY_BUILDERS: dict[str, StrategyBuilder] = {
    "buy_hold": lambda params: BuyHoldStrategy(),
    "ma_cross": lambda params: MACrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20))),
    "ema_cross": lambda params: EMACrossStrategy(fast=int(params.get("fast", 8)), slow=int(params.get("slow", 21))),
    "alma_cross": lambda params: ALMACrossStrategy(fast=int(params.get("fast", 9)), slow=int(params.get("slow", 21))),
    "lsma_cross": lambda params: LSMACrossStrategy(fast=int(params.get("fast", 9)), slow=int(params.get("slow", 21))),
    "mcginley_cross": lambda params: McGinleyCrossStrategy(fast=int(params.get("fast", 8)), slow=int(params.get("slow", 21))),
    "t3_cross": lambda params: T3CrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20))),
    "trima_cross": lambda params: TRIMACrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20))),
    "smma_cross": lambda params: SMMACrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20))),
    "vwma_cross": lambda params: VWMACrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20))),
    "dema_cross": lambda params: DEMACrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20))),
    "zlema_cross": lambda params: ZLEMACrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20))),
    "tema_cross": lambda params: TEMACrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20))),
    "wma_cross": lambda params: WMACrossStrategy(fast=int(params.get("fast", 5)), slow=int(params.get("slow", 20))),
    "hma_cross": lambda params: HMACrossStrategy(fast=int(params.get("fast", 9)), slow=int(params.get("slow", 21))),
    "obv_trend": lambda params: OBVTrendStrategy(fast=int(params.get("fast", 8)), slow=int(params.get("slow", 21))),
    "macd_signal": lambda params: MACDSignalStrategy(),
    "rsi_reversal": lambda params: RSIReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", 30)),
        overbought=float(params.get("overbought", 70)),
    ),
    "stochastic_reversal": lambda params: StochasticReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", 20)),
        overbought=float(params.get("overbought", 80)),
    ),
    "bias_reversal": lambda params: BIASReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", -5.0)),
        overbought=float(params.get("overbought", 5.0)),
    ),
    "demarker_reversal": lambda params: DeMarkerReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", 30)),
        overbought=float(params.get("overbought", 70)),
    ),
    "cfo_reversal": lambda params: CFOReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", -2.0)),
        overbought=float(params.get("overbought", 2.0)),
    ),
    "smi_reversal": lambda params: SMIReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", -40.0)),
        overbought=float(params.get("overbought", 40.0)),
    ),
    "awesome_reversal": lambda params: AwesomeReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", -1.0)),
        overbought=float(params.get("overbought", 1.0)),
    ),
    "schaff_reversal": lambda params: SchaffReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", 25)),
        overbought=float(params.get("overbought", 75)),
    ),
    "ultimate_oscillator_reversal": lambda params: UltimateOscillatorReversalStrategy(
        period=int(params.get("period", 7)),
        oversold=float(params.get("oversold", 30)),
        overbought=float(params.get("overbought", 70)),
    ),
    "stochrsi_reversal": lambda params: StochRSIReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", 20)),
        overbought=float(params.get("overbought", 80)),
    ),
    "rvi_reversal": lambda params: RVIReversalStrategy(
        period=int(params.get("period", 10)),
        oversold=float(params.get("oversold", -0.2)),
        overbought=float(params.get("overbought", 0.2)),
    ),
    "mfi_reversal": lambda params: MFIReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", 20)),
        overbought=float(params.get("overbought", 80)),
    ),
    "cmo_reversal": lambda params: CMOReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", -50)),
        overbought=float(params.get("overbought", 50)),
    ),
    "dpo_reversal": lambda params: DPOReversalStrategy(
        period=int(params.get("period", 20)),
        oversold=float(params.get("oversold", -2.0)),
        overbought=float(params.get("overbought", 2.0)),
    ),
    "fisher_reversal": lambda params: FisherReversalStrategy(
        period=int(params.get("period", 10)),
        oversold=float(params.get("oversold", -1.5)),
        overbought=float(params.get("overbought", 1.5)),
    ),
    "williams_reversal": lambda params: WilliamsReversalStrategy(
        period=int(params.get("period", 14)),
        oversold=float(params.get("oversold", -80)),
        overbought=float(params.get("overbought", -20)),
    ),
    "supertrend_follow": lambda params: SupertrendFollowStrategy(
        period=int(params.get("period", 10)),
        multiplier=float(params.get("multiplier", 3.0)),
    ),
    "adx_trend": lambda params: ADXTrendStrategy(
        period=int(params.get("period", 14)),
        threshold=float(params.get("threshold", 25.0)),
    ),
    "dmi_breakout": lambda params: DMIBreakoutStrategy(
        period=int(params.get("period", 14)),
        threshold=float(params.get("threshold", 25.0)),
    ),
    "chaikin_money_flow_trend": lambda params: ChaikinMoneyFlowTrendStrategy(
        period=int(params.get("period", 20)),
        threshold=float(params.get("threshold", 0.05)),
    ),
    "chaikin_volatility_trend": lambda params: ChaikinVolatilityTrendStrategy(
        period=int(params.get("period", 10)),
        threshold=float(params.get("threshold", 10.0)),
    ),
    "aroon_trend": lambda params: AroonTrendStrategy(
        period=int(params.get("period", 25)),
        threshold=float(params.get("threshold", 70.0)),
    ),
    "efi_trend": lambda params: EFITrendStrategy(
        period=int(params.get("period", 13)),
        threshold=float(params.get("threshold", 1000.0)),
    ),
    "vzo_trend": lambda params: VZOTrendStrategy(
        period=int(params.get("period", 14)),
        threshold=float(params.get("threshold", 15.0)),
    ),
    "kst_trend": lambda params: KSTTrendStrategy(
        period=int(params.get("period", 10)),
        threshold=float(params.get("threshold", 5.0)),
    ),
    "vhf_trend": lambda params: VHFTrendStrategy(
        period=int(params.get("period", 14)),
        threshold=float(params.get("threshold", 0.4)),
    ),
    "roc_breakout": lambda params: ROCBreakoutStrategy(
        period=int(params.get("period", 12)),
        threshold=float(params.get("threshold", 5.0)),
    ),
    "linreg_slope_trend": lambda params: LinRegSlopeTrendStrategy(
        period=int(params.get("period", 14)),
        threshold=float(params.get("threshold", 0.3)),
    ),
    "trix_trend": lambda params: TrixTrendStrategy(
        period=int(params.get("period", 15)),
        threshold=float(params.get("threshold", 0.2)),
    ),
    "tsi_trend": lambda params: TSITrendStrategy(
        period=int(params.get("period", 13)),
        threshold=float(params.get("threshold", 10.0)),
    ),
    "pmo_trend": lambda params: PMOTrendStrategy(
        period=int(params.get("period", 12)),
        threshold=float(params.get("threshold", 0.5)),
    ),
    "coppock_trend": lambda params: CoppockTrendStrategy(
        period=int(params.get("period", 14)),
        threshold=float(params.get("threshold", 0.5)),
    ),
    "vortex_trend": lambda params: VortexTrendStrategy(
        period=int(params.get("period", 14)),
        threshold=float(params.get("threshold", 0.1)),
    ),
    "keltner_reversion": lambda params: KeltnerReversionStrategy(
        period=int(params.get("period", 20)),
        multiplier=float(params.get("multiplier", 1.5)),
    ),
    "vwap_reversion": lambda params: VWAPReversionStrategy(
        period=int(params.get("period", 20)),
        deviation_pct=float(params.get("deviation_pct", 3.0)),
    ),
    "atr_breakout": lambda params: ATRBreakoutStrategy(
        period=int(params.get("period", 14)),
        multiplier=float(params.get("multiplier", 2.0)),
    ),
    "cci_reversal": lambda params: CCIReversalStrategy(
        period=int(params.get("period", 20)),
        oversold=float(params.get("oversold", -100)),
        overbought=float(params.get("overbought", 100)),
    ),
    "chaikin_reversal": lambda params: ChaikinReversalStrategy(
        fast=int(params.get("fast", 3)),
        slow=int(params.get("slow", 10)),
    ),
    "bollinger_reversion": lambda params: BollingerReversionStrategy(
        period=int(params.get("period", 20)),
        stddev=float(params.get("stddev", 2.0)),
    ),
    "donchian_breakout": lambda params: DonchianBreakoutStrategy(
        lookback=int(params.get("lookback", 20)),
        exit_lookback=int(params.get("exit_lookback", 10)),
    ),
}


def _build_strategy(name: str, params: dict[str, Any]):
    builder = STRATEGY_BUILDERS.get(name)
    if builder is None:
        raise ValueError(f"unsupported strategy: {name}")
    return builder(params)


@router.get("/strategies")
async def list_backtest_strategies() -> dict[str, Any]:
    """Return strategy metadata for the single-asset backtest workspace."""
    catalog = _strategy_catalog()
    return {
        "data": [item.model_dump() for item in catalog],
        "meta": {"count": len(catalog)},
    }


@router.post("/compare")
async def compare_backtest_strategies(payload: BacktestCompareRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Run multiple single-asset strategies on the same window and compare their metrics."""
    _validate_date_range(payload.start_date, payload.end_date)

    strategy_names = list(dict.fromkeys(name for name in payload.strategy_names if name))
    if not strategy_names:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_COMPARE_SET", "At least one strategy must be provided for comparison.", {}),
        )
    invalid_names = [name for name in strategy_names if name not in STRATEGY_BUILDERS]
    if invalid_names:
        raise HTTPException(
            status_code=400,
            detail=_error(
                "INVALID_COMPARE_SET",
                "One or more strategies are unsupported for comparison.",
                {"strategies": invalid_names},
            ),
        )

    symbol = payload.symbol.upper()
    db_session = db if isinstance(db, AsyncSession) else None
    df, ohlcv_meta = await _load_backtest_ohlcv(
        db=db_session,
        symbol=symbol,
        asset_type=payload.asset_type,
        start_date=payload.start_date,
        end_date=payload.end_date,
        sync_if_missing=payload.sync_if_missing,
    )
    if not payload.sync_if_missing and not bool(ohlcv_meta.get("coverage_complete")):
        raise HTTPException(
            status_code=409,
            detail=_error(
                "LOCAL_DATA_INCOMPLETE",
                "Local history does not fully cover the requested compare window; sync data first or enable auto sync.",
                {"symbol": symbol, "start_date": payload.start_date, "end_date": payload.end_date},
            ),
        )
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No kline data for strategy comparison", {"symbol": symbol}),
        )

    comparison_rows: list[dict[str, Any]] = []
    for name in strategy_names:
        try:
            strategy = _build_strategy(name, payload.parameters_by_strategy.get(name, {}))
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=_error("INVALID_STRATEGY_PARAMS", str(exc), {"strategy": name}),
            ) from exc

        engine = BacktestEngine(strategy=strategy, initial_capital=payload.initial_capital)
        result = engine.run(df=df, symbol=symbol, asset_type=payload.asset_type)
        comparison_rows.append(_compare_row(name, result.get("metrics", {})))

    comparison_rows = _sort_compare_rows(comparison_rows, payload.ranking_metric)
    used_local_only = ohlcv_meta.get("source") == "local" and not bool(ohlcv_meta.get("sync_performed"))
    return {
        "data": comparison_rows,
        "meta": {
            "count": len(comparison_rows),
            "ranking_metric": payload.ranking_metric,
            "ohlcv_source": "local" if used_local_only else "live",
            "storage_source": ohlcv_meta.get("source"),
            "sync_performed": bool(ohlcv_meta.get("sync_performed")),
            "stale": bool(ohlcv_meta.get("stale")),
            "as_of": ohlcv_meta.get("as_of"),
            "provider": ohlcv_meta.get("provider"),
            "fetch_source": ohlcv_meta.get("fetch_source"),
            "coverage_complete": bool(ohlcv_meta.get("coverage_complete")),
        },
    }


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


def _validate_date_range(start_date: str, end_date: str) -> None:
    """Reject invalid backtest windows early."""
    try:
        start_ts = pd.Timestamp(start_date)
        end_ts = pd.Timestamp(end_date)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_DATE_FORMAT", "start_date and end_date must be valid dates in YYYY-MM-DD format", {}),
        ) from exc

    if start_ts >= end_ts:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_DATE_RANGE", "start_date must be earlier than end_date", {}),
        )


async def _load_backtest_ohlcv(
    db: AsyncSession | None,
    symbol: str,
    asset_type: str,
    start_date: str,
    end_date: str,
    sync_if_missing: bool = True,
) -> tuple[Any, dict[str, Any]]:
    """Load backtest OHLCV window from local store first, syncing when needed."""
    return await load_ohlcv_window(
        db=db,
        symbol=symbol,
        asset_type=asset_type,
        start_date=start_date,
        end_date=end_date,
        interval="1d",
        sync_if_missing=sync_if_missing,
    )


@router.post("/run")
async def run_backtest(payload: BacktestRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Run strategy backtest and return equity curve/trades/metrics."""
    _validate_date_range(payload.start_date, payload.end_date)
    try:
        strategy = _build_strategy(payload.strategy_name, payload.parameters)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_STRATEGY_PARAMS", str(exc), {"strategy": payload.strategy_name}),
        ) from exc

    symbol = payload.symbol.upper()
    db_session = db if isinstance(db, AsyncSession) else None
    df, ohlcv_meta = await _load_backtest_ohlcv(
        db=db_session,
        symbol=symbol,
        asset_type=payload.asset_type,
        start_date=payload.start_date,
        end_date=payload.end_date,
        sync_if_missing=payload.sync_if_missing,
    )
    if not payload.sync_if_missing and not bool(ohlcv_meta.get("coverage_complete")):
        raise HTTPException(
            status_code=409,
            detail=_error(
                "LOCAL_DATA_INCOMPLETE",
                "Local history does not fully cover the requested backtest window; sync data first or enable auto sync.",
                {"symbol": symbol, "start_date": payload.start_date, "end_date": payload.end_date},
            ),
        )
    if df.empty:
        raise HTTPException(
            status_code=404,
            detail=_error("DATA_NOT_FOUND", "No kline data for backtest", {"symbol": symbol}),
        )

    engine = BacktestEngine(strategy=strategy, initial_capital=payload.initial_capital)
    result = engine.run(df=df, symbol=symbol, asset_type=payload.asset_type)
    used_local_only = ohlcv_meta.get("source") == "local" and not bool(ohlcv_meta.get("sync_performed"))
    return {
        "data": result,
        "meta": {
            "ohlcv_source": "local" if used_local_only else "live",
            "storage_source": ohlcv_meta.get("source"),
            "sync_performed": bool(ohlcv_meta.get("sync_performed")),
            "stale": bool(ohlcv_meta.get("stale")),
            "as_of": ohlcv_meta.get("as_of"),
            "provider": ohlcv_meta.get("provider"),
            "fetch_source": ohlcv_meta.get("fetch_source"),
            "coverage_complete": bool(ohlcv_meta.get("coverage_complete")),
        },
    }


@router.post("/lab")
async def run_backtest_lab(payload: BacktestLabRequest, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Run batch backtest over latest market stock universe with pagination."""
    _validate_date_range(payload.start_date, payload.end_date)
    try:
        strategy = _build_strategy(payload.strategy_name, payload.parameters)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_STRATEGY_PARAMS", str(exc), {"strategy": payload.strategy_name}),
        ) from exc

    manual_symbols = [str(item or "").upper().strip() for item in payload.symbols]
    deduped_symbols: list[str] = []
    seen_symbols: set[str] = set()
    for symbol in manual_symbols:
        if not symbol or symbol in seen_symbols:
            continue
        seen_symbols.add(symbol)
        deduped_symbols.append(symbol)

    if payload.symbols and not deduped_symbols:
        raise HTTPException(
            status_code=400,
            detail=_error("INVALID_SYMBOLS", "symbols must include at least one valid stock symbol", {}),
        )

    if deduped_symbols:
        snapshot = [{"symbol": symbol, "name": symbol, "market": payload.market.upper()} for symbol in deduped_symbols]
        snapshot_meta = {
            "source": "manual",
            "stale": False,
            "as_of": datetime.now(timezone.utc).isoformat(),
            "cache_age_sec": 0,
        }
        total_available = len(snapshot)
        total_meta = {"source": "manual", "stale": False, "as_of": snapshot_meta["as_of"], "cache_age_sec": 0}
    else:
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
        total_available, total_meta = fetch_stock_universe_total_with_meta(
            payload.market,
            force_refresh=payload.force_refresh,
            allow_stale=payload.allow_stale,
        )

    engine = BacktestEngine(strategy=strategy, initial_capital=payload.initial_capital)
    db_session = db if isinstance(db, AsyncSession) else None
    ranked_rows: list[dict[str, Any]] = []
    live_ohlcv_symbols = 0
    local_ohlcv_symbols = 0
    failed_ohlcv_symbols = 0

    for item in snapshot:
        symbol = str(item.get("symbol", "")).upper()
        if not symbol:
            continue

        df, ohlcv_meta = await _load_backtest_ohlcv(
            db=db_session,
            symbol=symbol,
            asset_type="stock",
            start_date=payload.start_date,
            end_date=payload.end_date,
        )
        if df.empty:
            failed_ohlcv_symbols += 1
            continue
        if ohlcv_meta.get("source") == "local" and not bool(ohlcv_meta.get("sync_performed")):
            local_ohlcv_symbols += 1
        else:
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
            "ohlcv_local_symbols": local_ohlcv_symbols,
            "ohlcv_failed_symbols": failed_ohlcv_symbols,
            "ohlcv_local_fallback_symbols": local_ohlcv_symbols,
        },
    }
