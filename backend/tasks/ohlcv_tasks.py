"""Periodic OHLCV-related Celery tasks."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import akshare as ak
from sqlalchemy import text

from app.database import get_task_db_session
from app.services.ohlcv_store import sync_ohlcv_from_upstream
from app.services.openbb_adapter import detect_provider
from tasks.celery_app import celery_app


@celery_app.task(name="tasks.ohlcv_tasks.sync_cn_watchlist")
def sync_cn_watchlist() -> dict[str, object]:
    async def _run() -> dict[str, object]:
        end_date = datetime.now(timezone.utc).date()
        start_date = end_date - timedelta(days=180)
        async with get_task_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT symbol
                    FROM watchlist_items
                    WHERE asset_type = 'stock' AND symbol ~ '^[0-9]{6}\\.(SH|SZ|BJ)$'
                    ORDER BY sort_order ASC, added_at DESC
                    LIMIT 20
                    """
                )
            )
            rows = [str(symbol).upper() for symbol in result.scalars().all()]
            synced_rows = 0
            synced_symbols: list[str] = []
            failed_symbols: list[str] = []
            for symbol in rows:
                try:
                    asset_type, _ = detect_provider(symbol)
                    frame, _ = await sync_ohlcv_from_upstream(
                        db=session,
                        symbol=symbol,
                        asset_type=asset_type,
                        start_date=start_date.isoformat(),
                        end_date=end_date.isoformat(),
                        interval="1d",
                    )
                    if not frame.empty:
                        synced_rows += len(frame)
                    synced_symbols.append(symbol)
                except Exception:
                    failed_symbols.append(symbol)
            return {
                "status": "completed",
                "synced_symbols": len(synced_symbols),
                "synced_rows": synced_rows,
                "symbols": synced_symbols,
                "failed_symbols": failed_symbols,
                "window": {
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat(),
                },
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

    return asyncio.run(_run())


@celery_app.task(name="tasks.ohlcv_tasks.sync_northbound")
def sync_northbound() -> dict[str, object]:
    async def _run() -> dict[str, object]:
        frame = ak.stock_hsgt_fund_flow_summary_em()
        rows = []
        for row in frame.to_dict("records"):
            direction = row.get("资金方向")
            board = row.get("板块")
            if direction != "北向" or board not in {"沪股通", "深股通"}:
                continue
            rows.append(
                {
                    "trade_date": row.get("交易日"),
                    "market": "SH" if board == "沪股通" else "SZ",
                    "net_buy": row.get("成交净买额") or 0,
                    "buy_amount": row.get("资金净流入") or 0,
                    "sell_amount": 0,
                    "hold_amount": row.get("当日资金余额") or 0,
                }
            )
        async with get_task_db_session() as session:
            if rows:
                await session.execute(
                    text(
                        """
                        INSERT INTO cn_northbound_flow(trade_date, market, net_buy, buy_amount, sell_amount, hold_amount)
                        VALUES (:trade_date, :market, :net_buy, :buy_amount, :sell_amount, :hold_amount)
                        ON CONFLICT (trade_date, market) DO UPDATE SET
                            net_buy = EXCLUDED.net_buy,
                            buy_amount = EXCLUDED.buy_amount,
                            sell_amount = EXCLUDED.sell_amount,
                            hold_amount = EXCLUDED.hold_amount
                        """
                    ),
                    rows,
                )
                await session.commit()
            return {
                "status": "completed",
                "rows_synced": len(rows),
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

    return asyncio.run(_run())
