"""Event-driven backtest engine for stock/crypto strategies."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from backtest.metrics import calc_metrics


@dataclass
class Trade:
    """Single transaction record."""

    date: str
    symbol: str
    action: str
    price: float
    shares: float
    commission: float
    pnl: float = 0.0


class BacktestEngine:
    """Run trading strategy on historical OHLCV series."""

    def __init__(
        self,
        strategy,
        initial_capital: float = 1_000_000.0,
        commission_rate: float = 0.0003,
        stamp_duty: float = 0.001,
        crypto_fee_rate: float = 0.001,
    ):
        self.strategy = strategy
        self.initial_capital = initial_capital
        self.commission_rate = commission_rate
        self.stamp_duty = stamp_duty
        self.crypto_fee_rate = crypto_fee_rate

    def run(self, df: pd.DataFrame, symbol: str, asset_type: str) -> dict:
        """Execute backtest loop and return equity curve/trades/metrics."""
        cash = self.initial_capital
        shares = 0.0
        avg_cost = 0.0
        trades: list[dict] = []
        equity_curve: list[dict] = []

        fee_rate = self.crypto_fee_rate if asset_type == "crypto" else self.commission_rate

        for i in range(len(df)):
            row = df.iloc[i]
            date = str(row["time"].date())
            close = float(row["close"])

            # Critical anti-lookahead guard:
            # only pass history up to current bar to strategy.
            signal = self.strategy.generate_signal(df.iloc[: i + 1])

            # Execute at current close for simplified simulation.
            if signal == 1 and shares == 0 and cash > 0:
                buy_amount = cash * 0.9
                commission = buy_amount * fee_rate
                shares = (buy_amount - commission) / close
                avg_cost = close
                cash -= buy_amount
                trades.append(Trade(date, symbol, "buy", close, shares, commission).__dict__)

            elif signal == -1 and shares > 0:
                sell_amount = shares * close
                commission = sell_amount * fee_rate
                tax = sell_amount * self.stamp_duty if asset_type == "stock" else 0.0
                pnl = (close - avg_cost) * shares - commission - tax
                cash += sell_amount - commission - tax
                trades.append(Trade(date, symbol, "sell", close, shares, commission, pnl).__dict__)
                shares = 0.0
                avg_cost = 0.0

            portfolio_value = cash + shares * close
            equity_curve.append({"date": date, "value": round(portfolio_value, 2)})

        metrics = calc_metrics(equity_curve, trades, self.initial_capital)
        return {"equity_curve": equity_curve, "trades": trades, "metrics": metrics}
