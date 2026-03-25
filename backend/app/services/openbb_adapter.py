"""Multi-provider market-data adapter layer.

This module keeps the existing function signatures while routing to AKShare,
YFinance, CoinGecko, and Eastmoney instead of relying on OpenBB at runtime.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from io import StringIO
from typing import Any, Literal
import logging
import re
import time

import pandas as pd

from app.services.market_cache import (
    cache_get_json,
    cache_set_json,
    snapshot_ttl_seconds,
    symbols_ttl_seconds,
    total_ttl_seconds,
)
from app.services.quote_provider_controller import (
    fetch_crypto_realtime_quotes as _fetch_crypto_realtime_quotes,
    fetch_realtime_quotes as _fetch_realtime_quotes,
    fetch_stock_realtime_quotes as _fetch_stock_realtime_quotes,
)

logger = logging.getLogger(__name__)

try:
    import akshare as ak
except Exception:  # pragma: no cover - optional runtime dependency
    ak = None

try:
    from openbb import obb  # type: ignore
except Exception:  # pragma: no cover - optional runtime dependency
    obb = None

CRYPTO_SYMBOLS = {
    "BTC",
    "ETH",
    "BNB",
    "SOL",
    "XRP",
    "ADA",
    "AVAX",
    "DOGE",
    "DOT",
    "MATIC",
    "LINK",
    "UNI",
    "ATOM",
    "LTC",
    "BCH",
    "XLM",
    "ALGO",
    "VET",
    "ICP",
    "FIL",
}

OHLCVInterval = Literal["1m", "5m", "1h", "1d", "1W", "1M"]
INTRADAY_INTERVALS = {"1m", "5m", "1h"}

CN_STOCK_UNIVERSE_URL = "https://push2.eastmoney.com/api/qt/clist/get"
NASDAQ_STOCK_SCREENER_URL = "https://api.nasdaq.com/api/screener/stocks"
SINA_HQ_NODE_DATA_URL = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData"
)
SINA_HQ_NODE_COUNT_URL = (
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount"
)
TENCENT_QUOTE_URL = "https://qt.gtimg.cn/q="
SNAPSHOT_STALE_TTL_SECONDS = 24 * 3600
TOTAL_STALE_TTL_SECONDS = 7 * 24 * 3600
SYMBOLS_STALE_TTL_SECONDS = 24 * 3600


def _elapsed_ms(start_ts: float) -> int:
    """Elapsed milliseconds for lightweight fetch telemetry."""
    return max(0, int((time.perf_counter() - start_ts) * 1000))


def _parse_eastmoney_payload(payload: dict, limit: int) -> list[dict]:
    """Parse Eastmoney A-share list payload into normalized symbol rows."""
    diff = payload.get("data", {}).get("diff", [])
    if not isinstance(diff, list):
        return []

    out: list[dict] = []
    for item in diff:
        code = str(item.get("f12", "")).strip()
        name = str(item.get("f14", "")).strip() or code

        if not code.isdigit() or len(code) != 6:
            continue

        # 6* and 5* generally map to Shanghai; others in this universe map to Shenzhen.
        suffix = ".SH" if code.startswith(("5", "6", "9")) else ".SZ"
        out.append({"symbol": f"{code}{suffix}", "name": name, "asset_type": "stock", "market": "CN"})
        if len(out) >= limit:
            break

    return out


def _to_number(value: object) -> float | None:
    """Normalize numeric-like values (string '-'/'$1,234'/'1.2%' -> float)."""
    if value in (None, "-", ""):
        return None
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "").replace("$", "").replace("%", "")
        if cleaned in ("", "-", "--", "N/A", "n/a"):
            return None
        value = cleaned
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _utc_now() -> datetime:
    """UTC now helper for cache metadata."""
    return datetime.now(timezone.utc)


def _to_iso(dt: datetime) -> str:
    """Format aware datetime to stable UTC ISO timestamp."""
    return dt.astimezone(timezone.utc).isoformat()


def _parse_iso(ts: Any) -> datetime | None:
    """Parse ISO string and normalize to UTC."""
    if not isinstance(ts, str) or not ts:
        return None
    try:
        parsed = datetime.fromisoformat(ts)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _age_seconds(as_of: datetime | None, now_utc: datetime | None = None) -> int | None:
    """Compute cache age in seconds."""
    if as_of is None:
        return None
    if now_utc is None:
        now_utc = _utc_now()
    delta = int((now_utc - as_of).total_seconds())
    return max(delta, 0)


def _snapshot_cache_keys(market: str, limit: int) -> tuple[str, str]:
    market_norm = market.lower().strip()
    return (
        f"market:snapshot:fresh:{market_norm}:{limit}",
        f"market:snapshot:stale:{market_norm}:{limit}",
    )


def _total_cache_keys(market: str) -> tuple[str, str]:
    market_norm = market.lower().strip()
    return (
        f"market:total:fresh:{market_norm}",
        f"market:total:stale:{market_norm}",
    )


def _symbols_cache_keys(market: str, limit: int) -> tuple[str, str]:
    market_norm = market.lower().strip()
    return (
        f"market:symbols:fresh:{market_norm}:{limit}",
        f"market:symbols:stale:{market_norm}:{limit}",
    )


def _snapshot_meta(source: str, stale: bool, as_of: datetime | None) -> dict[str, Any]:
    """Build unified metadata for market snapshot/symbol cache responses."""
    now_utc = _utc_now()
    age = _age_seconds(as_of, now_utc)
    return {
        "source": source,
        "stale": stale,
        "as_of": _to_iso(as_of) if as_of is not None else None,
        "cache_age_sec": age,
        "refresh_in_progress": False,
    }


def _eastmoney_market_fs(market: Literal["us", "cn"]) -> str:
    """Map market code to Eastmoney fs expression."""
    if market == "us":
        return "m:105,m:106,m:107"
    return "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"


def _fetch_eastmoney_snapshot(market: Literal["us", "cn"], limit: int) -> list[dict]:
    """Fetch market snapshot rows from Eastmoney."""
    import requests

    target = min(max(limit, 1), 20000)
    page_size = min(max(target, 30), 100)
    max_pages = max(1, (target + page_size - 1) // page_size)
    rows: list[dict] = []
    seen_symbols: set[str] = set()

    for page in range(1, max_pages + 1):
        payload = None
        page_error: Exception | None = None
        for attempt in range(3):
            try:
                resp = requests.get(
                    CN_STOCK_UNIVERSE_URL,
                    params={
                        "pn": page,
                        "pz": page_size,
                        "po": 1,
                        "np": 1,
                        "fltt": 2,
                        "invt": 2,
                        "fid": "f3",
                        "fs": _eastmoney_market_fs(market),
                        # f2: latest, f3: change_pct, f9: PE, f23: PB, f37: ROE, f129: profit yoy
                        "fields": "f12,f14,f2,f3,f9,f23,f37,f129,f20",
                    },
                    timeout=10,
                    headers={"User-Agent": "finance-platform/0.1"},
                )
                resp.raise_for_status()
                payload = resp.json()
                break
            except Exception as exc:
                page_error = exc
                if attempt < 2:
                    time.sleep(0.25 * (attempt + 1))

        if payload is None:
            if rows:
                break
            if page_error is not None:
                raise page_error
            break

        diff = payload.get("data", {}).get("diff", [])
        if not isinstance(diff, list) or not diff:
            break

        for item in diff:
            code = str(item.get("f12", "")).upper().strip()
            name = str(item.get("f14", "")).strip() or code
            if not code:
                continue

            symbol = code
            if market == "cn":
                if not code.isdigit() or len(code) != 6:
                    continue
                suffix = ".SH" if code.startswith(("5", "6", "9")) else ".SZ"
                symbol = f"{code}{suffix}"

            if symbol in seen_symbols:
                continue
            seen_symbols.add(symbol)

            rows.append(
                {
                    "symbol": symbol,
                    "name": name,
                    "asset_type": "stock",
                    "market": market.upper(),
                    "last_price": _to_number(item.get("f2")),
                    "change_pct": _to_number(item.get("f3")),
                    "pe_ttm": _to_number(item.get("f9")),
                    "pb": _to_number(item.get("f23")),
                    "roe": _to_number(item.get("f37")),
                    "profit_yoy": _to_number(item.get("f129")),
                    "market_cap": _to_number(item.get("f20")),
                }
            )
            if len(rows) >= target:
                break

        if len(rows) >= target:
            break
        if len(diff) < page_size:
            break

    return rows


def _fetch_eastmoney_total(market: Literal["us", "cn"]) -> int:
    """Fetch total available symbol count for a market from Eastmoney."""
    import requests

    payload = None
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            resp = requests.get(
                CN_STOCK_UNIVERSE_URL,
                params={
                    "pn": 1,
                    "pz": 1,
                    "po": 1,
                    "np": 1,
                    "fltt": 2,
                    "invt": 2,
                    "fid": "f3",
                    "fs": _eastmoney_market_fs(market),
                    "fields": "f12",
                },
                timeout=10,
                headers={"User-Agent": "finance-platform/0.1"},
            )
            resp.raise_for_status()
            payload = resp.json()
            break
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.25 * (attempt + 1))

    if payload is None:
        if last_error is not None:
            raise last_error
        return 0

    total = payload.get("data", {}).get("total")
    try:
        count = int(total)
        return count if count >= 0 else 0
    except (TypeError, ValueError):
        return 0


def _normalize_us_symbol(symbol: str) -> str:
    """Normalize US ticker to a provider-neutral backend symbol."""
    return symbol.upper().strip().replace("/", "-")


def _iter_chunks(items: list[str], size: int) -> list[list[str]]:
    """Split list into fixed-size chunks."""
    if size <= 0:
        return [items]
    return [items[i : i + size] for i in range(0, len(items), size)]


def _fetch_tencent_quote_map(symbols: list[str]) -> dict[str, list[str]]:
    """Fetch Tencent quote payloads and return parsed '~' token arrays by key."""
    import requests

    out: dict[str, list[str]] = {}
    if not symbols:
        return out

    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://gu.qq.com/"}
    for chunk in _iter_chunks(symbols, 120):
        payload = None
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                resp = requests.get(
                    f"{TENCENT_QUOTE_URL}{','.join(chunk)}",
                    timeout=12,
                    headers=headers,
                )
                resp.raise_for_status()
                payload = resp.text
                break
            except Exception as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.2 * (attempt + 1))

        if payload is None:
            if last_error is not None:
                logger.warning("Tencent quote batch failed: %s", last_error)
            continue

        for line in payload.splitlines():
            if not line.startswith("v_") or "=" not in line:
                continue
            key = line.split("=", 1)[0].strip()[2:]
            body = line.split('="', 1)[1].rsplit('";', 1)[0] if '="' in line else ""
            if not body:
                continue
            out[key] = body.split("~")

    return out


def _fetch_nasdaq_total() -> int:
    """Fetch total US listed stocks from Nasdaq screener API."""
    import requests

    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    resp = requests.get(
        NASDAQ_STOCK_SCREENER_URL,
        params={"tableonly": "true", "limit": 1, "offset": 0},
        timeout=12,
        headers=headers,
    )
    resp.raise_for_status()
    payload = resp.json()

    total = payload.get("data", {}).get("totalrecords")
    try:
        count = int(total)
        return count if count >= 0 else 0
    except (TypeError, ValueError):
        return 0


def _enrich_us_snapshot_with_tencent(rows: list[dict]) -> None:
    """Enrich US rows with PE/PB/ROE/Growth from Tencent US quote stream."""
    if not rows:
        return

    token_to_row: dict[str, dict] = {}
    for row in rows:
        symbol = str(row.get("symbol", "")).upper().strip()
        if not symbol:
            continue
        token = f"us{symbol.replace('-', '.')}"
        token_to_row[token] = row

    quote_map = _fetch_tencent_quote_map(list(token_to_row.keys()))
    for token, parts in quote_map.items():
        row = token_to_row.get(token)
        if row is None:
            continue

        row["last_price"] = _to_number(parts[3] if len(parts) > 3 else row.get("last_price")) or row.get("last_price")
        row["change_pct"] = _to_number(parts[32] if len(parts) > 32 else row.get("change_pct")) or row.get("change_pct")
        row["pe_ttm"] = _to_number(parts[39] if len(parts) > 39 else None)
        row["pb"] = _to_number(parts[43] if len(parts) > 43 else None)
        row["roe"] = _to_number(parts[58] if len(parts) > 58 else None)
        row["profit_yoy"] = _to_number(parts[59] if len(parts) > 59 else None)

        # Tencent index 45 is in 100M CNY/USD units for many symbols.
        if row.get("market_cap") is None:
            cap_100m = _to_number(parts[45] if len(parts) > 45 else None)
            if cap_100m is not None:
                row["market_cap"] = cap_100m * 100_000_000


def _fetch_nasdaq_snapshot(limit: int) -> list[dict]:
    """Fetch US stock snapshot rows from Nasdaq screener API."""
    import requests

    target = min(max(limit, 1), 20000)
    page_size = min(max(target, 50), 200)
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}

    rows: list[dict] = []
    seen_symbols: set[str] = set()
    offset = 0

    while len(rows) < target:
        payload = None
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                resp = requests.get(
                    NASDAQ_STOCK_SCREENER_URL,
                    params={"tableonly": "true", "limit": page_size, "offset": offset},
                    timeout=12,
                    headers=headers,
                )
                resp.raise_for_status()
                payload = resp.json()
                break
            except Exception as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.2 * (attempt + 1))

        if payload is None:
            if last_error is not None:
                raise last_error
            break

        batch = payload.get("data", {}).get("table", {}).get("rows", [])
        if not isinstance(batch, list) or not batch:
            break

        for item in batch:
            symbol_raw = str(item.get("symbol", "")).strip()
            symbol = _normalize_us_symbol(symbol_raw)
            if not symbol or symbol in seen_symbols:
                continue
            if re.fullmatch(r"[A-Z0-9.\-]+", symbol) is None:
                continue

            seen_symbols.add(symbol)
            rows.append(
                {
                    "symbol": symbol,
                    "name": str(item.get("name", "")).strip() or symbol,
                    "asset_type": "stock",
                    "market": "US",
                    "last_price": _to_number(item.get("lastsale")),
                    "change_pct": _to_number(item.get("pctchange")),
                    "pe_ttm": None,
                    "pb": None,
                    "roe": None,
                    "profit_yoy": None,
                    "market_cap": _to_number(item.get("marketCap")),
                }
            )
            if len(rows) >= target:
                break

        if len(rows) >= target:
            break

        if len(batch) < page_size:
            break
        offset += page_size

    _enrich_us_snapshot_with_tencent(rows)
    return rows[:target]


def _fetch_sina_cn_total() -> int:
    """Fetch total A-share universe size from Sina market center."""
    import requests

    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://vip.stock.finance.sina.com.cn/"}
    total = 0
    for node in ("sh_a", "sz_a"):
        resp = requests.get(
            SINA_HQ_NODE_COUNT_URL,
            params={"node": node},
            timeout=12,
            headers=headers,
        )
        resp.raise_for_status()
        text = resp.text.strip().strip('"').strip("'")
        try:
            count = int(text)
            total += max(count, 0)
        except (TypeError, ValueError):
            continue
    return total


def _enrich_cn_snapshot_with_tencent(rows: list[dict]) -> None:
    """Enrich CN rows with ROE/Growth/PE/PB from Tencent CN quote stream."""
    if not rows:
        return

    token_to_row: dict[str, dict] = {}
    for row in rows:
        raw = str(row.get("_tencent_symbol", "")).lower().strip()
        if raw:
            token_to_row[raw] = row

    quote_map = _fetch_tencent_quote_map(list(token_to_row.keys()))
    for token, parts in quote_map.items():
        row = token_to_row.get(token)
        if row is None:
            continue

        row["last_price"] = _to_number(parts[3] if len(parts) > 3 else row.get("last_price")) or row.get("last_price")
        row["change_pct"] = _to_number(parts[32] if len(parts) > 32 else row.get("change_pct")) or row.get("change_pct")
        row["pe_ttm"] = _to_number(parts[39] if len(parts) > 39 else row.get("pe_ttm")) or row.get("pe_ttm")
        row["pb"] = _to_number(parts[49] if len(parts) > 49 else row.get("pb")) or row.get("pb")
        row["roe"] = _to_number(parts[64] if len(parts) > 64 else None)
        row["profit_yoy"] = _to_number(parts[65] if len(parts) > 65 else None)


def _fetch_sina_cn_node_snapshot(node: Literal["sh_a", "sz_a"], limit: int) -> list[dict]:
    """Fetch one CN market node snapshot from Sina market center."""
    import requests

    target = min(max(limit, 1), 20000)
    page_size = min(max(target, 20), 80)
    max_pages = max(1, (target + page_size - 1) // page_size)
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://vip.stock.finance.sina.com.cn/"}

    rows: list[dict] = []
    seen_symbols: set[str] = set()
    for page in range(1, max_pages + 1):
        payload = None
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                resp = requests.get(
                    SINA_HQ_NODE_DATA_URL,
                    params={
                        "page": page,
                        "num": page_size,
                        "sort": "symbol",
                        "asc": 1,
                        "node": node,
                        "symbol": "",
                        "_s_r_a": "init",
                    },
                    timeout=12,
                    headers=headers,
                )
                resp.raise_for_status()
                payload = resp.json()
                break
            except Exception as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(0.2 * (attempt + 1))

        if payload is None:
            if last_error is not None:
                raise last_error
            break

        if not isinstance(payload, list) or not payload:
            break

        for item in payload:
            raw_symbol = str(item.get("symbol", "")).lower().strip()
            code = str(item.get("code", "")).strip()
            if not raw_symbol or not code.isdigit() or len(code) != 6:
                continue

            if raw_symbol.startswith("sh"):
                symbol = f"{code}.SH"
            elif raw_symbol.startswith("sz"):
                symbol = f"{code}.SZ"
            else:
                continue

            if symbol in seen_symbols:
                continue
            seen_symbols.add(symbol)
            rows.append(
                {
                    "symbol": symbol,
                    "name": str(item.get("name", "")).strip() or symbol,
                    "asset_type": "stock",
                    "market": "CN",
                    "last_price": _to_number(item.get("trade")),
                    "change_pct": _to_number(item.get("changepercent")),
                    "pe_ttm": _to_number(item.get("per")),
                    "pb": _to_number(item.get("pb")),
                    "roe": None,
                    "profit_yoy": None,
                    "market_cap": _to_number(item.get("mktcap")),
                    "_tencent_symbol": raw_symbol,
                }
            )
            if len(rows) >= target:
                break

        if len(rows) >= target:
            break
        if len(payload) < page_size:
            break

    _enrich_cn_snapshot_with_tencent(rows)
    for row in rows:
        row.pop("_tencent_symbol", None)
    return rows[:target]


def _fetch_sina_cn_snapshot(limit: int) -> list[dict]:
    """Fetch CN stock snapshot rows (Shanghai + Shenzhen) from Sina."""
    target = min(max(limit, 1), 20000)
    sh_target = max(1, target // 2)
    sz_target = max(1, target - sh_target)

    rows = _fetch_sina_cn_node_snapshot("sh_a", sh_target) + _fetch_sina_cn_node_snapshot("sz_a", sz_target)
    if len(rows) >= target:
        return rows[:target]

    # Fill remainder from Shanghai first, then Shenzhen.
    remaining = target - len(rows)
    if remaining > 0:
        rows.extend(_fetch_sina_cn_node_snapshot("sh_a", remaining))
    if len(rows) < target:
        rows.extend(_fetch_sina_cn_node_snapshot("sz_a", target - len(rows)))

    dedup: dict[str, dict] = {}
    for row in rows:
        dedup[str(row.get("symbol"))] = row
    return list(dedup.values())[:target]


def _fetch_stock_snapshot_live(market: Literal["us", "cn", "all"] = "us", limit: int = 100) -> list[dict]:
    """Fetch latest stock snapshot rows from upstream providers."""
    started = time.perf_counter()
    market_norm = market.lower().strip()
    if market_norm not in {"us", "cn", "all"} or limit <= 0:
        return []

    rows: list[dict] = []
    primary_provider = "nasdaq" if market_norm == "us" else ("sina" if market_norm == "cn" else "nasdaq+sina")
    try:
        if market_norm == "us":
            rows = _fetch_nasdaq_snapshot(limit)
        elif market_norm == "cn":
            rows = _fetch_sina_cn_snapshot(limit)
        else:
            half = max(1, limit // 2)
            rows = _fetch_nasdaq_snapshot(half) + _fetch_sina_cn_snapshot(limit - half)
    except Exception as exc:
        logger.warning("Primary snapshot fetch failed for %s: %s", market_norm, exc)
        rows = []

    if rows:
        logger.info(
            "Live snapshot fetched market=%s provider=%s rows=%d elapsed_ms=%d",
            market_norm,
            primary_provider,
            len(rows),
            _elapsed_ms(started),
        )
        return rows[:limit]

    if not rows:
        try:
            if market_norm == "us":
                rows = _fetch_eastmoney_snapshot("us", limit)
            elif market_norm == "cn":
                rows = _fetch_eastmoney_snapshot("cn", limit)
            else:
                half = max(1, limit // 2)
                rows = _fetch_eastmoney_snapshot("us", half) + _fetch_eastmoney_snapshot("cn", limit - half)
        except Exception as exc:
            logger.warning("Eastmoney snapshot fetch failed for %s: %s", market_norm, exc)
            rows = []

    if rows:
        logger.info(
            "Live snapshot fetched market=%s provider=eastmoney rows=%d elapsed_ms=%d",
            market_norm,
            len(rows),
            _elapsed_ms(started),
        )
        return rows[:limit]

    # Only return live snapshot data from upstream market feed.
    logger.warning(
        "Live snapshot unavailable market=%s limit=%d elapsed_ms=%d",
        market_norm,
        limit,
        _elapsed_ms(started),
    )
    return []


def _fetch_stock_universe_total_live(market: Literal["us", "cn", "all"] = "us") -> int:
    """Fetch total available symbols for market from live upstream feed."""
    started = time.perf_counter()
    market_norm = market.lower().strip()
    if market_norm not in {"us", "cn", "all"}:
        return 0

    primary_total = 0
    primary_provider = "nasdaq" if market_norm == "us" else ("sina" if market_norm == "cn" else "nasdaq+sina")
    try:
        if market_norm == "us":
            primary_total = _fetch_nasdaq_total()
        elif market_norm == "cn":
            primary_total = _fetch_sina_cn_total()
        else:
            primary_total = _fetch_nasdaq_total() + _fetch_sina_cn_total()
    except Exception as exc:
        logger.warning("Primary universe total fetch failed for %s: %s", market_norm, exc)
        primary_total = 0

    if primary_total > 0:
        logger.info(
            "Live universe total fetched market=%s provider=%s total=%d elapsed_ms=%d",
            market_norm,
            primary_provider,
            primary_total,
            _elapsed_ms(started),
        )
        return primary_total

    try:
        if market_norm == "us":
            total = _fetch_eastmoney_total("us")
        elif market_norm == "cn":
            total = _fetch_eastmoney_total("cn")
        else:
            total = _fetch_eastmoney_total("us") + _fetch_eastmoney_total("cn")
        if total > 0:
            logger.info(
                "Live universe total fetched market=%s provider=eastmoney total=%d elapsed_ms=%d",
                market_norm,
                total,
                _elapsed_ms(started),
            )
        else:
            logger.warning(
                "Live universe total unavailable market=%s elapsed_ms=%d",
                market_norm,
                _elapsed_ms(started),
            )
        return total
    except Exception as exc:
        logger.warning("Eastmoney universe total fetch failed for %s: %s", market_norm, exc)
        return 0


def fetch_stock_snapshot_with_meta(
    market: Literal["us", "cn", "all"] = "us",
    limit: int = 100,
    *,
    force_refresh: bool = False,
    allow_stale: bool = True,
) -> tuple[list[dict], dict[str, Any]]:
    """Fetch latest stock snapshot rows with cache/source metadata."""
    started = time.perf_counter()
    market_norm = market.lower().strip()
    if market_norm not in {"us", "cn", "all"} or limit <= 0:
        return [], _snapshot_meta("live", False, None)

    fresh_key, stale_key = _snapshot_cache_keys(market_norm, limit)
    if not force_refresh:
        cached = cache_get_json(fresh_key)
        if isinstance(cached, dict):
            rows = cached.get("rows")
            as_of = _parse_iso(cached.get("as_of"))
            if isinstance(rows, list) and rows:
                logger.info(
                    "Snapshot cache hit market=%s limit=%d rows=%d elapsed_ms=%d",
                    market_norm,
                    limit,
                    len(rows),
                    _elapsed_ms(started),
                )
                return rows[:limit], _snapshot_meta("cache", False, as_of)

    live_rows = _fetch_stock_snapshot_live(market_norm, limit)
    if live_rows:
        as_of = _utc_now()
        payload = {"rows": live_rows, "as_of": _to_iso(as_of)}
        cache_set_json(fresh_key, payload, snapshot_ttl_seconds(market_norm))
        cache_set_json(stale_key, payload, SNAPSHOT_STALE_TTL_SECONDS)
        logger.info(
            "Snapshot live result market=%s limit=%d rows=%d elapsed_ms=%d",
            market_norm,
            limit,
            len(live_rows),
            _elapsed_ms(started),
        )
        return live_rows[:limit], _snapshot_meta("live", False, as_of)

    if allow_stale:
        stale = cache_get_json(stale_key)
        if isinstance(stale, dict):
            rows = stale.get("rows")
            as_of = _parse_iso(stale.get("as_of"))
            if isinstance(rows, list) and rows:
                logger.warning(
                    "Snapshot stale cache fallback market=%s limit=%d rows=%d elapsed_ms=%d",
                    market_norm,
                    limit,
                    len(rows),
                    _elapsed_ms(started),
                )
                return rows[:limit], _snapshot_meta("cache", True, as_of)

    logger.error(
        "Snapshot fetch failed market=%s limit=%d force_refresh=%s allow_stale=%s elapsed_ms=%d",
        market_norm,
        limit,
        force_refresh,
        allow_stale,
        _elapsed_ms(started),
    )
    return [], _snapshot_meta("live", False, None)


def fetch_stock_snapshot(
    market: Literal["us", "cn", "all"] = "us",
    limit: int = 100,
    *,
    force_refresh: bool = False,
    allow_stale: bool = True,
) -> list[dict]:
    """Fetch latest stock snapshot rows by market (with local cache)."""
    rows, _ = fetch_stock_snapshot_with_meta(
        market=market,
        limit=limit,
        force_refresh=force_refresh,
        allow_stale=allow_stale,
    )
    return rows


def fetch_stock_universe_total_with_meta(
    market: Literal["us", "cn", "all"] = "us",
    *,
    force_refresh: bool = False,
    allow_stale: bool = True,
) -> tuple[int, dict[str, Any]]:
    """Fetch universe total with cache/source metadata."""
    started = time.perf_counter()
    market_norm = market.lower().strip()
    if market_norm not in {"us", "cn", "all"}:
        return 0, _snapshot_meta("live", False, None)

    fresh_key, stale_key = _total_cache_keys(market_norm)
    if not force_refresh:
        cached = cache_get_json(fresh_key)
        if isinstance(cached, dict):
            total = cached.get("total")
            as_of = _parse_iso(cached.get("as_of"))
            if isinstance(total, int) and total > 0:
                logger.info(
                    "Universe total cache hit market=%s total=%d elapsed_ms=%d",
                    market_norm,
                    total,
                    _elapsed_ms(started),
                )
                return total, _snapshot_meta("cache", False, as_of)

    total = _fetch_stock_universe_total_live(market_norm)
    if total > 0:
        as_of = _utc_now()
        payload = {"total": total, "as_of": _to_iso(as_of)}
        cache_set_json(fresh_key, payload, total_ttl_seconds(market_norm))
        cache_set_json(stale_key, payload, TOTAL_STALE_TTL_SECONDS)
        logger.info(
            "Universe total live result market=%s total=%d elapsed_ms=%d",
            market_norm,
            total,
            _elapsed_ms(started),
        )
        return total, _snapshot_meta("live", False, as_of)

    if allow_stale:
        stale = cache_get_json(stale_key)
        if isinstance(stale, dict):
            stale_total = stale.get("total")
            as_of = _parse_iso(stale.get("as_of"))
            if isinstance(stale_total, int) and stale_total > 0:
                logger.warning(
                    "Universe total stale cache fallback market=%s total=%d elapsed_ms=%d",
                    market_norm,
                    stale_total,
                    _elapsed_ms(started),
                )
                return stale_total, _snapshot_meta("cache", True, as_of)

    logger.error(
        "Universe total fetch failed market=%s force_refresh=%s allow_stale=%s elapsed_ms=%d",
        market_norm,
        force_refresh,
        allow_stale,
        _elapsed_ms(started),
    )
    return 0, _snapshot_meta("live", False, None)


def fetch_stock_universe_total(
    market: Literal["us", "cn", "all"] = "us",
    *,
    force_refresh: bool = False,
    allow_stale: bool = True,
) -> int:
    """Fetch total available symbols for market."""
    total, _ = fetch_stock_universe_total_with_meta(
        market=market,
        force_refresh=force_refresh,
        allow_stale=allow_stale,
    )
    return total


def fetch_stock_symbols_with_meta(
    market: Literal["us", "cn", "all"] = "us",
    limit: int = 100,
    *,
    force_refresh: bool = False,
    allow_stale: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fetch latest stock symbols by market with cache/source metadata."""
    started = time.perf_counter()
    market_norm = market.lower().strip()
    if market_norm not in {"us", "cn", "all"} or limit <= 0:
        return [], _snapshot_meta("live", False, None)

    fresh_key, stale_key = _symbols_cache_keys(market_norm, limit)

    if not force_refresh:
        cached = cache_get_json(fresh_key)
        if isinstance(cached, dict):
            rows = cached.get("rows")
            as_of = _parse_iso(cached.get("as_of"))
            if isinstance(rows, list) and rows:
                logger.info(
                    "Symbols cache hit market=%s limit=%d rows=%d elapsed_ms=%d",
                    market_norm,
                    limit,
                    len(rows),
                    _elapsed_ms(started),
                )
                return rows[:limit], _snapshot_meta("cache", False, as_of)

    snapshots, snapshot_meta = fetch_stock_snapshot_with_meta(
        market=market_norm,
        limit=limit,
        force_refresh=force_refresh,
        allow_stale=allow_stale,
    )
    rows = [
        {
            "symbol": row["symbol"],
            "name": row.get("name") or row["symbol"],
            "asset_type": "stock",
            "market": row.get("market", "US"),
        }
        for row in snapshots[:limit]
    ]
    if rows:
        as_of = snapshot_meta.get("as_of") or _to_iso(_utc_now())
        payload = {"rows": rows, "as_of": as_of}
        cache_set_json(fresh_key, payload, symbols_ttl_seconds(market_norm))
        cache_set_json(stale_key, payload, SYMBOLS_STALE_TTL_SECONDS)
        logger.info(
            "Symbols live result market=%s limit=%d rows=%d elapsed_ms=%d",
            market_norm,
            limit,
            len(rows),
            _elapsed_ms(started),
        )
        return rows, snapshot_meta

    if allow_stale:
        stale = cache_get_json(stale_key)
        if isinstance(stale, dict):
            stale_rows = stale.get("rows")
            as_of = _parse_iso(stale.get("as_of"))
            if isinstance(stale_rows, list) and stale_rows:
                logger.warning(
                    "Symbols stale cache fallback market=%s limit=%d rows=%d elapsed_ms=%d",
                    market_norm,
                    limit,
                    len(stale_rows),
                    _elapsed_ms(started),
                )
                return stale_rows[:limit], _snapshot_meta("cache", True, as_of)

    logger.error(
        "Symbols fetch failed market=%s limit=%d force_refresh=%s allow_stale=%s elapsed_ms=%d",
        market_norm,
        limit,
        force_refresh,
        allow_stale,
        _elapsed_ms(started),
    )
    return [], snapshot_meta


def fetch_stock_symbols(
    market: Literal["us", "cn", "all"] = "us",
    limit: int = 100,
    *,
    force_refresh: bool = False,
    allow_stale: bool = True,
) -> list[dict]:
    """Fetch latest stock symbols by market."""
    rows, _ = fetch_stock_symbols_with_meta(
        market=market,
        limit=limit,
        force_refresh=force_refresh,
        allow_stale=allow_stale,
    )
    return rows


def detect_provider(symbol: str) -> tuple[str, str]:
    """Detect asset type and preferred data provider from symbol format.

    Returns:
        (asset_type, provider)
        asset_type: "stock" or "crypto"
        provider: "akshare" | "yfinance" | "coingecko"
    """
    s = symbol.upper().strip()

    # Crypto: direct symbol whitelist, or common USD/USDT quoted pairs.
    clean = s.replace("-USD", "").replace("-USDT", "")
    if clean in CRYPTO_SYMBOLS or s.endswith(("-USD", "-USDT")):
        return ("crypto", "coingecko")

    # CN/HK equity symbol heuristics.
    if s.endswith((".SZ", ".SH", ".BJ")) or (s.isdigit() and len(s) == 6):
        return ("stock", "akshare")
    if s.endswith(".HK"):
        return ("stock", "akshare")

    # Default to US equity provider.
    return ("stock", "yfinance")


def normalize_symbol(symbol: str, provider: str) -> str:
    """Normalize symbol for the target provider contract."""
    s = symbol.upper().strip()

    if provider == "akshare":
        # akshare uses raw numeric codes without suffix.
        return s.split(".")[0]

    if provider == "coingecko":
        # CoinGecko is still keyed by the base token; keep a predictable USD pair.
        base = s.replace("-USD", "").replace("-USDT", "")
        return f"{base}-USD"

    return s


def _interval_to_yfinance(interval: OHLCVInterval) -> str:
    """Map unified interval contract to yfinance interval syntax."""
    return {
        "1m": "1m",
        "5m": "5m",
        "1h": "60m",
        "1d": "1d",
        "1W": "1wk",
        "1M": "1mo",
    }[interval]


def _interval_to_binance(interval: Literal["1m", "5m", "1h"]) -> str:
    return {"1m": "1m", "5m": "5m", "1h": "1h"}[interval]


def _fetch_ohlcv_akshare(
    symbol: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    if ak is None:
        raise RuntimeError("AKShare is unavailable")

    raw_symbol = symbol.upper().split(".")[0]
    df = ak.stock_zh_a_hist(
        symbol=raw_symbol,
        period="daily",
        start_date=start_date.replace("-", ""),
        end_date=end_date.replace("-", ""),
        adjust="qfq",
    )
    if df.empty:
        return pd.DataFrame()
    return df.rename(
        columns={
            "日期": "time",
            "开盘": "open",
            "最高": "high",
            "最低": "low",
            "收盘": "close",
            "成交量": "volume",
        }
    )


def _coingecko_id(symbol: str) -> str:
    mapping = {
        "BTC": "bitcoin",
        "ETH": "ethereum",
        "BNB": "binancecoin",
        "SOL": "solana",
        "XRP": "ripple",
        "ADA": "cardano",
        "AVAX": "avalanche-2",
        "DOGE": "dogecoin",
        "DOT": "polkadot",
        "LINK": "chainlink",
        "LTC": "litecoin",
    }
    base = symbol.upper().replace("-USD", "").replace("-USDT", "")
    return mapping.get(base, base.lower())


def _fetch_ohlcv_coingecko(
    symbol: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    import requests

    start_ts = int(pd.Timestamp(start_date, tz="UTC").timestamp())
    end_ts = int((pd.Timestamp(end_date, tz="UTC") + pd.Timedelta(days=1)).timestamp())
    response = requests.get(
        f"https://api.coingecko.com/api/v3/coins/{_coingecko_id(symbol)}/market_chart/range",
        params={"vs_currency": "usd", "from": start_ts, "to": end_ts},
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json()
    prices = pd.DataFrame(payload.get("prices", []), columns=["ts", "price"])
    volumes = pd.DataFrame(payload.get("total_volumes", []), columns=["ts", "volume"])
    if prices.empty:
        return pd.DataFrame()
    prices["time"] = pd.to_datetime(prices["ts"], unit="ms", utc=True)
    prices["trade_date"] = prices["time"].dt.floor("D")
    grouped = prices.groupby("trade_date")["price"]
    out = grouped.agg(open="first", high="max", low="min", close="last").reset_index()
    if not volumes.empty:
        volumes["time"] = pd.to_datetime(volumes["ts"], unit="ms", utc=True)
        volumes["trade_date"] = volumes["time"].dt.floor("D")
        daily_vol = volumes.groupby("trade_date")["volume"].last().reset_index()
        out = out.merge(daily_vol, on="trade_date", how="left")
    out["volume"] = out.get("volume", 0).fillna(0)
    out["time"] = out["trade_date"]
    return out[["time", "open", "high", "low", "close", "volume"]]


def _fetch_ohlcv_binance_intraday(
    symbol: str,
    start_date: str,
    end_date: str,
    interval: Literal["1m", "5m", "1h"],
) -> pd.DataFrame:
    """Fetch crypto intraday candles from Binance public kline endpoint."""
    import requests

    base = symbol.upper().strip().replace("-USD", "").replace("-USDT", "")
    pair = f"{base}USDT"
    granularity = _interval_to_binance(interval)
    start_ts = int(pd.Timestamp(start_date, tz="UTC").timestamp() * 1000)
    end_ts = int((pd.Timestamp(end_date, tz="UTC") + pd.Timedelta(days=1)).timestamp() * 1000)

    rows: list[list[Any]] = []
    next_start = start_ts
    while next_start < end_ts:
        response = requests.get(
            "https://api.binance.com/api/v3/klines",
            params={
                "symbol": pair,
                "interval": granularity,
                "startTime": next_start,
                "endTime": end_ts,
                "limit": 1000,
            },
            timeout=10,
        )
        response.raise_for_status()
        batch = response.json()
        if not isinstance(batch, list) or not batch:
            break
        rows.extend(batch)
        last_open_time = int(batch[-1][0])
        next_start = last_open_time + 1
        if len(batch) < 1000:
            break

    if not rows:
        return pd.DataFrame()

    frame = pd.DataFrame(
        rows,
        columns=[
            "open_time",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "close_time",
            "quote_volume",
            "trade_count",
            "taker_buy_base_volume",
            "taker_buy_quote_volume",
            "ignore",
        ],
    )
    frame["time"] = pd.to_datetime(frame["open_time"], unit="ms", utc=True)
    frame["open"] = pd.to_numeric(frame["open"], errors="coerce")
    frame["high"] = pd.to_numeric(frame["high"], errors="coerce")
    frame["low"] = pd.to_numeric(frame["low"], errors="coerce")
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame["volume"] = pd.to_numeric(frame["volume"], errors="coerce")
    return frame[["time", "open", "high", "low", "close", "volume"]]


def _fetch_ohlcv_openbb(
    symbol: str,
    provider: str,
    asset_type: str,
    start_date: str,
    end_date: str,
    interval: OHLCVInterval,
) -> pd.DataFrame:
    """Fetch OHLCV via OpenBB SDK."""
    if obb is None:
        raise RuntimeError("OpenBB SDK is unavailable")

    if asset_type == "stock":
        result = obb.equity.price.historical(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            provider=provider,
            interval=interval,
        )
    else:
        result = obb.crypto.price.historical(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            provider=provider,
            interval=interval,
        )

    return result.to_dataframe().reset_index()


def _fetch_ohlcv_yfinance(
    symbol: str,
    provider: str,
    start_date: str,
    end_date: str,
    interval: OHLCVInterval,
) -> pd.DataFrame:
    """Fallback OHLCV fetch using yfinance."""
    import yfinance as yf

    yf_symbol = symbol.upper().strip()

    # Convert A-share/hk style symbols to yfinance-compatible symbols.
    if provider == "akshare":
        s = yf_symbol
        if s.endswith(".SZ"):
            yf_symbol = f"{s.split('.')[0]}.SZ"
        elif s.endswith(".SH"):
            yf_symbol = f"{s.split('.')[0]}.SS"
        elif s.endswith(".BJ"):
            yf_symbol = f"{s.split('.')[0]}.BJ"
        elif s.endswith(".HK"):
            yf_symbol = s
        elif s.isdigit() and len(s) == 6:
            yf_symbol = f"{s}.SS"

    # For crypto fallback use pair quote in USD.
    if provider == "coingecko":
        yf_symbol = normalize_symbol(yf_symbol, "coingecko")

    # yfinance end date is exclusive; add one day to include the boundary.
    end_inclusive = (pd.to_datetime(end_date) + timedelta(days=1)).strftime("%Y-%m-%d")

    df = yf.download(
        tickers=yf_symbol,
        start=start_date,
        end=end_inclusive,
        interval=_interval_to_yfinance(interval),
        auto_adjust=False,
        progress=False,
        threads=False,
    )

    if df.empty:
        return pd.DataFrame()

    return df.reset_index()


def _fetch_ohlcv_stooq(
    symbol: str,
    provider: str,
    start_date: str,
    end_date: str,
) -> pd.DataFrame:
    """Final OHLCV fallback using Stooq CSV endpoint."""
    import requests

    s = symbol.upper().strip()
    if provider == "coingecko":
        # Stooq has limited crypto coverage; keep the original token as-is.
        stooq_symbol = s.lower()
    elif s.endswith(".SZ"):
        stooq_symbol = f"{s.split('.')[0]}.cn"
    elif s.endswith(".SH") or (s.isdigit() and len(s) == 6):
        stooq_symbol = f"{s.split('.')[0]}.cn"
    elif s.endswith(".BJ"):
        stooq_symbol = f"{s.split('.')[0]}.cn"
    elif s.endswith(".HK"):
        stooq_symbol = f"{s.split('.')[0]}.hk"
    else:
        stooq_symbol = f"{s.lower()}.us"

    resp = requests.get(
        "https://stooq.com/q/d/l/",
        params={"s": stooq_symbol, "i": "d"},
        timeout=8,
    )
    resp.raise_for_status()

    df = pd.read_csv(StringIO(resp.text))
    if df.empty:
        return pd.DataFrame()

    # Filter by request window to align with function contract.
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    mask = (df["Date"] >= pd.to_datetime(start_date)) & (df["Date"] <= pd.to_datetime(end_date))
    return df.loc[mask].reset_index(drop=True)


def _normalize_ohlcv_frame(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    """Normalize diverse provider outputs into a standard OHLCV DataFrame."""
    if df.empty:
        return pd.DataFrame()

    if isinstance(df.columns, pd.MultiIndex):
        # Keep only column names from the first level for single-ticker payloads.
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]

    rename = {
        "date": "time",
        "Date": "time",
        "datetime": "time",
        "Datetime": "time",
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Adj Close": "close",
        "Volume": "volume",
    }
    df = df.rename(columns=rename)
    # yfinance may expose both "Close" and "Adj Close", which both map to "close".
    # Keep the first occurrence to preserve 1-D Series semantics.
    if df.columns.duplicated().any():
        df = df.loc[:, ~df.columns.duplicated()]

    if "time" not in df.columns:
        logger.error("No time column for %s", symbol)
        return pd.DataFrame()

    # Normalize timestamp to UTC to keep backend/frontend contract stable.
    df["time"] = pd.to_datetime(df["time"], utc=True)

    if "volume" not in df.columns:
        df["volume"] = 0

    for col in ["open", "high", "low", "close", "volume"]:
        if col not in df.columns:
            logger.error("Missing column %s for %s", col, symbol)
            return pd.DataFrame()
        # Force numeric conversion and mark broken cells as NaN.
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Drop rows with broken OHLC values to avoid propagating bad candles.
    df = df.dropna(subset=["open", "high", "low", "close"])

    # Keep only active trading rows as requested by the spec.
    df = df[df["volume"] > 0]

    df = df.sort_values("time").reset_index(drop=True)
    return df[["time", "open", "high", "low", "close", "volume"]]


def fetch_ohlcv_with_meta(
    symbol: str,
    start_date: str,
    end_date: str,
    interval: OHLCVInterval = "1d",
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Fetch OHLCV history for stocks or crypto and return standardized columns.

    Args:
        symbol: e.g. "000001.SZ", "AAPL", "BTC", "BTC-USD".
        start_date: Inclusive start date in YYYY-MM-DD.
        end_date: Inclusive end date in YYYY-MM-DD.
        interval: "1d" | "1W" | "1M".

    Returns:
        Tuple:
            - DataFrame with columns [time(UTC), open, high, low, close, volume].
            - Metadata including source/provider/as_of/stale flags.
    """
    started = time.perf_counter()
    asset_type, provider = detect_provider(symbol)
    normalized = normalize_symbol(symbol, provider)
    source = "yfinance"
    df = pd.DataFrame()
    if interval in INTRADAY_INTERVALS:
        if asset_type == "crypto":
            try:
                df = _fetch_ohlcv_binance_intraday(
                    symbol=symbol,
                    start_date=start_date,
                    end_date=end_date,
                    interval=interval,
                )
                source = "binance"
            except Exception as exc:
                logger.warning("Binance intraday fetch failed for %s, fallback to yfinance: %s", symbol, exc)
        if df.empty:
            try:
                df = _fetch_ohlcv_yfinance(
                    symbol=symbol,
                    provider=provider,
                    start_date=start_date,
                    end_date=end_date,
                    interval=interval,
                )
                source = "yfinance"
            except Exception as exc:
                logger.warning("yfinance intraday fetch failed for %s: %s", symbol, exc)
                df = pd.DataFrame()
    elif provider == "akshare":
        try:
            df = _fetch_ohlcv_akshare(symbol, start_date, end_date)
            source = "akshare"
        except Exception as exc:
            logger.warning("AKShare fetch_ohlcv failed for %s, fallback to yfinance: %s", symbol, exc)
    elif provider == "coingecko":
        try:
            df = _fetch_ohlcv_coingecko(symbol, start_date, end_date)
            source = "coingecko"
        except Exception as exc:
            logger.warning("CoinGecko fetch_ohlcv failed for %s, fallback to yfinance: %s", symbol, exc)

    if df.empty:
        try:
            df = _fetch_ohlcv_yfinance(
                symbol=symbol,
                provider=provider,
                start_date=start_date,
                end_date=end_date,
                interval=interval,
            )
            source = "yfinance"
        except Exception as fallback_exc:
            logger.warning("yfinance fallback failed for %s: %s", symbol, fallback_exc)
            df = pd.DataFrame()

    if df.empty and interval not in INTRADAY_INTERVALS:
        try:
            source = "stooq"
            df = _fetch_ohlcv_stooq(
                symbol=symbol,
                provider=provider,
                start_date=start_date,
                end_date=end_date,
            )
        except Exception as final_exc:
            logger.error("Stooq fallback failed for %s: %s", symbol, final_exc)
            return pd.DataFrame(), _snapshot_meta("live", False, None)

    out = _normalize_ohlcv_frame(df, symbol)
    as_of = _utc_now() if not out.empty else None
    logger.info(
        "OHLCV fetch result symbol=%s provider=%s source=%s rows=%d elapsed_ms=%d",
        symbol.upper(),
        provider,
        source,
        len(out),
        _elapsed_ms(started),
    )
    meta = _snapshot_meta("live", False, as_of)
    meta["provider"] = provider
    meta["fetch_source"] = source
    meta["asset_type"] = asset_type
    return out, meta


def fetch_ohlcv(
    symbol: str,
    start_date: str,
    end_date: str,
    interval: OHLCVInterval = "1d",
) -> pd.DataFrame:
    """Backward-compatible OHLCV fetch helper returning only DataFrame."""
    out, _ = fetch_ohlcv_with_meta(
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
        interval=interval,
    )
    return out


def fetch_fundamentals(symbol: str) -> pd.DataFrame:
    """Fetch stock fundamentals (PE/PB/ROE and core metrics).

    Notes:
        This function is stock-only. Callers should avoid invoking it for crypto symbols.
    """
    _, provider = detect_provider(symbol)
    normalized = normalize_symbol(symbol, provider)

    if provider == "akshare" and ak is not None:
        try:
            abstract_df = ak.stock_financial_abstract_ths(symbol=normalized.split(".")[0])
            info_df = ak.stock_individual_info_em(symbol=normalized.split(".")[0])
            info_map = {}
            if not info_df.empty:
                info_map = {str(row["item"]): row["value"] for _, row in info_df.iterrows()}
            if not abstract_df.empty:
                renamed = abstract_df.rename(
                    columns={
                        "报告期": "report_date",
                        "净利润": "net_income",
                        "净利润同比增长率": "profit_yoy",
                        "营业总收入": "total_revenue",
                        "营业总收入同比增长率": "revenue_yoy",
                        "基本每股收益": "eps",
                        "净资产收益率": "roe",
                        "每股经营现金流": "operating_cashflow",
                        "资产负债率": "asset_liability_ratio",
                    }
                ).copy()
                renamed["symbol"] = symbol.upper()
                renamed["name"] = info_map.get("股票简称", symbol.upper())
                renamed["market_cap"] = info_map.get("总市值")
                renamed["pe_ttm"] = info_map.get("市盈率(动态)") or info_map.get("市盈率-动态")
                renamed["pb"] = info_map.get("市净率")
                renamed["report_period"] = "annual"
                return renamed.reset_index(drop=True)
        except Exception as exc:
            logger.warning("AKShare fetch_fundamentals failed for %s: %s", symbol, exc)

    # Minimal fallback using yfinance metadata fields.
    try:
        import yfinance as yf

        yf_symbol = normalized
        source_symbol = symbol.upper().strip()
        if provider == "akshare":
            if source_symbol.endswith(".SZ"):
                yf_symbol = f"{source_symbol.split('.')[0]}.SZ"
            elif source_symbol.endswith(".SH"):
                yf_symbol = f"{source_symbol.split('.')[0]}.SS"
            elif source_symbol.endswith(".HK"):
                yf_symbol = source_symbol
            elif source_symbol.isdigit() and len(source_symbol) == 6:
                yf_symbol = f"{source_symbol}.SS" if source_symbol.startswith(("5", "6", "9")) else f"{source_symbol}.SZ"

        info = yf.Ticker(yf_symbol).info
        row = {
            "symbol": source_symbol,
            "name": info.get("shortName") or info.get("longName") or source_symbol,
            "pe_ttm": info.get("trailingPE"),
            "pb": info.get("priceToBook"),
            "roe": info.get("returnOnEquity"),
            "profit_yoy": info.get("earningsQuarterlyGrowth"),
            "market_cap": info.get("marketCap"),
        }
        return pd.DataFrame([row])
    except Exception as exc:
        logger.error("Fallback fetch_fundamentals failed for %s: %s", symbol, exc)
        return pd.DataFrame()


def fetch_news(symbol: str, limit: int = 20) -> list[dict]:
    """Fetch latest symbol-related news for AI/sentiment workflows."""
    _, provider = detect_provider(symbol)
    normalized = normalize_symbol(symbol, provider)

    try:
        if obb is None:
            raise RuntimeError("OpenBB SDK is unavailable")
        result = obb.news.company(normalized, limit=limit, provider=provider)
        df = result.to_dataframe()
        cols = [c for c in ["title", "date", "url", "text", "source"] if c in df.columns]
        return df[cols].to_dict("records")
    except Exception as exc:
        logger.warning("OpenBB fetch_news failed for %s: %s", symbol, exc)

    try:
        import yfinance as yf

        news_items = yf.Ticker(normalized).news or []
        records: list[dict] = []
        for item in news_items[:limit]:
            records.append(
                {
                    "title": item.get("title"),
                    "date": item.get("providerPublishTime"),
                    "url": item.get("link"),
                    "text": item.get("summary"),
                    "source": item.get("publisher"),
                }
            )
        return records
    except Exception as exc:
        logger.error("Fallback fetch_news failed for %s: %s", symbol, exc)
        return []


def fetch_crypto_realtime_price(symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch crypto realtime quotes with provider fallback chain."""
    return _fetch_crypto_realtime_quotes(symbols)


def fetch_stock_realtime_price(symbols: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch stock realtime quotes with provider fallback chain."""
    return _fetch_stock_realtime_quotes(symbols)


def fetch_stock_realtime_quote(symbol: str) -> dict[str, Any]:
    """Compatibility helper returning one stock quote payload."""
    normalized = str(symbol or "").upper().strip()
    if not normalized:
        return {}
    rows = _fetch_stock_realtime_quotes([normalized])
    item = rows.get(normalized)
    return item if isinstance(item, dict) else {}


def fetch_realtime_price(symbols: list[str], asset_type: Literal["crypto", "stock"]) -> dict[str, dict[str, Any]]:
    """Unified realtime quote entrypoint for external callers."""
    return _fetch_realtime_quotes(symbols, asset_type)
