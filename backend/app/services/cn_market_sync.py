"""A-share auxiliary dataset sync helpers."""

from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
import time
from typing import Any
from zoneinfo import ZoneInfo

import akshare as ak
import requests
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_CN_TZ = ZoneInfo("Asia/Shanghai")


def _symbol_code(symbol: str) -> str:
    return symbol.upper().split(".")[0]


def _market_code(symbol: str) -> str:
    code = symbol.upper()
    if code.endswith(".SH") or code.startswith(("5", "6", "9")):
        return "sh"
    return "sz"


def _parse_snapshot_as_of(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        timestamp = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    if timestamp <= 0:
        return None
    if timestamp > 1_000_000_000_000:
        timestamp //= 1000
    return datetime.fromtimestamp(timestamp, tz=timezone.utc)


def fetch_sector_flow_snapshot(limit: int = 30) -> list[dict[str, Any]]:
    """Fetch a live CN sector flow snapshot for dashboard-style heatmaps.

    This intentionally bypasses the heavier AKShare wrapper and requests only the
    first Eastmoney ranking page, which is materially more stable for realtime UI
    refresh than paginating the full dataset.
    """

    url = "https://push2.eastmoney.com/api/qt/clist/get"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        ),
        "Referer": "https://data.eastmoney.com/bkzj/hy.html",
    }
    params = {
        "pn": "1",
        "pz": str(max(1, min(int(limit), 100))),
        "po": "1",
        "np": "1",
        "ut": "b2884a393a59ad64002292a3e90d46a5",
        "fltt": "2",
        "invt": "2",
        "fid0": "f62",
        "fs": "m:90 t:2",
        "stat": "1",
        "fields": "f14,f3,f62,f66,f72,f78,f84,f204,f205,f124",
        "rt": "52975239",
    }

    last_error: Exception | None = None
    diff_rows: list[dict[str, Any]] = []
    for attempt in range(3):
        try:
            params["_"] = str(int(time.time() * 1000))
            response = requests.get(url, params=params, headers=headers, timeout=12)
            response.raise_for_status()
            payload = response.json()
            diff_rows = payload.get("data", {}).get("diff") or []
            break
        except Exception as exc:  # pragma: no cover - exercised by runtime fallback
            last_error = exc
            if attempt < 2:
                time.sleep(0.8 * (attempt + 1))
    if not diff_rows:
        if last_error is not None:
            raise last_error
        return []

    rows: list[dict[str, Any]] = []
    for row in diff_rows[:limit]:
        display_name = str(row.get("f14") or "").strip()
        if not display_name:
            continue
        snapshot_as_of = _parse_snapshot_as_of(row.get("f124"))
        trade_date = snapshot_as_of.astimezone(_CN_TZ).date().isoformat() if snapshot_as_of is not None else None
        rows.append(
            {
                "symbol": display_name,
                "display_name": display_name,
                "entity_type": "sector",
                "leader_symbol": row.get("f204"),
                "leader_code": row.get("f205"),
                "trade_date": trade_date,
                "as_of": snapshot_as_of.isoformat() if snapshot_as_of is not None else None,
                "change_pct": row.get("f3"),
                "main_net": row.get("f62"),
                "super_large_net": row.get("f66"),
                "large_net": row.get("f72"),
                "medium_net": row.get("f78"),
                "small_net": row.get("f84"),
            }
        )
    return rows


async def ensure_margin_data(db: AsyncSession, symbol: str, lookback_days: int = 7) -> int:
    code = _symbol_code(symbol)
    rows: list[dict[str, Any]] = []
    for offset in range(lookback_days):
        trade_date = (date.today() - timedelta(days=offset)).strftime("%Y%m%d")
        try:
            if _market_code(symbol) == "sh":
                frame = ak.stock_margin_detail_sse(date=trade_date)
                filtered = frame[frame["标的证券代码"] == code]
                for row in filtered.to_dict("records"):
                    rows.append(
                        {
                            "symbol": symbol.upper(),
                            "trade_date": date.fromisoformat(f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}"),
                            "rzye": row.get("融资余额"),
                            "rzmre": row.get("融资买入额"),
                            "rqyl": row.get("融券余量"),
                            "rqmcl": row.get("融券卖出量"),
                            "rzrqye": row.get("融资余额"),
                        }
                    )
            else:
                frame = ak.stock_margin_detail_szse(date=trade_date)
                filtered = frame[frame["证券代码"] == code] if "证券代码" in frame.columns else frame[frame["标的证券代码"] == code]
                for row in filtered.to_dict("records"):
                    rows.append(
                        {
                            "symbol": symbol.upper(),
                            "trade_date": row.get("交易日期") or row.get("信用交易日期") or date.fromisoformat(f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}"),
                            "rzye": row.get("融资余额"),
                            "rzmre": row.get("融资买入额"),
                            "rqyl": row.get("融券余量"),
                            "rqmcl": row.get("融券卖出量"),
                            "rzrqye": row.get("融资融券余额") or row.get("融资余额"),
                        }
                    )
        except Exception:
            continue

    if rows:
        await db.execute(
            text(
                """
                INSERT INTO cn_margin_trading(symbol, trade_date, rzye, rzmre, rqyl, rqmcl, rzrqye)
                VALUES (:symbol, :trade_date, :rzye, :rzmre, :rqyl, :rqmcl, :rzrqye)
                ON CONFLICT (symbol, trade_date) DO UPDATE SET
                    rzye = EXCLUDED.rzye,
                    rzmre = EXCLUDED.rzmre,
                    rqyl = EXCLUDED.rqyl,
                    rqmcl = EXCLUDED.rqmcl,
                    rzrqye = EXCLUDED.rzrqye
                """
            ),
            rows,
        )
        await db.commit()
    return len(rows)


async def ensure_big_order_flow(db: AsyncSession, symbol: str, limit: int = 20) -> int:
    frame = ak.stock_individual_fund_flow(stock=_symbol_code(symbol), market=_market_code(symbol))
    rows = []
    for row in frame.tail(limit).to_dict("records"):
        rows.append(
            {
                "symbol": symbol.upper(),
                "trade_date": row.get("日期"),
                "super_large_net": row.get("超大单净流入-净额"),
                "large_net": row.get("大单净流入-净额"),
                "medium_net": row.get("中单净流入-净额"),
                "small_net": row.get("小单净流入-净额"),
                "main_net": row.get("主力净流入-净额"),
            }
        )
    if rows:
        await db.execute(
            text(
                """
                INSERT INTO cn_big_order_flow(symbol, trade_date, super_large_net, large_net, medium_net, small_net, main_net)
                VALUES (:symbol, :trade_date, :super_large_net, :large_net, :medium_net, :small_net, :main_net)
                ON CONFLICT (symbol, trade_date) DO UPDATE SET
                    super_large_net = EXCLUDED.super_large_net,
                    large_net = EXCLUDED.large_net,
                    medium_net = EXCLUDED.medium_net,
                    small_net = EXCLUDED.small_net,
                    main_net = EXCLUDED.main_net
                """
            ),
            rows,
        )
        await db.commit()
    return len(rows)


async def ensure_dragon_tiger_data(db: AsyncSession, symbol: str, lookback_days: int = 120) -> int:
    end_date = date.today()
    start_date = end_date - timedelta(days=lookback_days)
    frame = ak.stock_lhb_detail_em(
        start_date=start_date.strftime("%Y%m%d"),
        end_date=end_date.strftime("%Y%m%d"),
    )
    code = _symbol_code(symbol)
    filtered = frame[frame["代码"] == code] if not frame.empty else frame
    rows = []
    for row in filtered.head(20).to_dict("records"):
        rows.append(
            {
                "symbol": symbol.upper(),
                "trade_date": row.get("上榜日"),
                "reason": row.get("上榜原因"),
                "net_buy": row.get("龙虎榜净买额"),
                "buy_amount": row.get("龙虎榜买入额"),
                "sell_amount": row.get("龙虎榜卖出额"),
                "top_buyers": [],
                "top_sellers": [],
            }
        )
    if rows:
        await db.execute(
            text(
                """
                INSERT INTO cn_dragon_tiger(symbol, trade_date, reason, net_buy, buy_amount, sell_amount, top_buyers, top_sellers, created_at)
                VALUES (:symbol, :trade_date, :reason, :net_buy, :buy_amount, :sell_amount, :top_buyers, :top_sellers, NOW())
                ON CONFLICT (symbol, trade_date) DO UPDATE SET
                    reason = EXCLUDED.reason,
                    net_buy = EXCLUDED.net_buy,
                    buy_amount = EXCLUDED.buy_amount,
                    sell_amount = EXCLUDED.sell_amount,
                    top_buyers = EXCLUDED.top_buyers,
                    top_sellers = EXCLUDED.top_sellers
                """
            ),
            rows,
        )
        await db.commit()
    return len(rows)


async def ensure_northbound_flow(db: AsyncSession) -> int:
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
    if rows:
        await db.execute(
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
        await db.commit()
    return len(rows)
