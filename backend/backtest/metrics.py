"""Backtest performance metrics."""

from __future__ import annotations

import numpy as np
import pandas as pd


def calc_metrics(equity_curve: list, trades: list, initial_capital: float) -> dict:
    """Calculate total/annual return, sharpe, drawdown and win rate."""
    if not equity_curve:
        return {
            "total_return": 0.0,
            "annual_return": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown": 0.0,
            "win_rate": 0.0,
            "trade_count": 0,
        }

    df = pd.DataFrame(equity_curve).set_index("date")
    ret = df["value"].pct_change().dropna()

    # Total return = (ending / initial - 1) * 100
    total_return = (df["value"].iloc[-1] / initial_capital - 1) * 100

    # Annual return uses actual elapsed days for annualization.
    n_days = (pd.to_datetime(df.index[-1]) - pd.to_datetime(df.index[0])).days
    annual_return = ((1 + total_return / 100) ** (365 / max(n_days, 1)) - 1) * 100

    # Sharpe = mean(excess daily return) / std(daily return) * sqrt(252)
    rf_daily = 0.025 / 252
    sharpe = ((ret - rf_daily).mean() / ret.std()) * np.sqrt(252) if ret.std() > 0 else 0.0

    # Max drawdown = max decline from rolling peak.
    rolling_max = df["value"].cummax()
    drawdown = (df["value"] - rolling_max) / rolling_max
    max_drawdown = abs(drawdown.min()) * 100

    sells = [t for t in trades if t["action"] == "sell"]
    win_rate = len([t for t in sells if t.get("pnl", 0) > 0]) / len(sells) * 100 if sells else 0.0

    return {
        "total_return": round(float(total_return), 2),
        "annual_return": round(float(annual_return), 2),
        "sharpe_ratio": round(float(sharpe), 3),
        "max_drawdown": round(float(max_drawdown), 2),
        "win_rate": round(float(win_rate), 2),
        "trade_count": len(sells),
    }
