"""OpenBB adapter layer and market-data fallbacks.

This module is the only data-fetch entry point for market/fundamental/news data.
"""

from __future__ import annotations

from datetime import timedelta
from io import StringIO
from typing import Literal
import logging

import pandas as pd

logger = logging.getLogger(__name__)

try:
    # OpenBB may not be available in all environments; fallback logic handles this.
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

US_STOCK_UNIVERSE_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv"
CN_STOCK_UNIVERSE_URL = "https://push2.eastmoney.com/api/qt/clist/get"


def _parse_sp500_constituents_csv(content: str, limit: int) -> list[dict]:
    """Parse S&P 500 CSV into normalized stock symbol rows."""
    try:
        df = pd.read_csv(StringIO(content))
    except Exception as exc:
        logger.warning("Failed parsing US universe CSV: %s", exc)
        return []

    if df.empty:
        return []

    df.columns = [str(c).strip().lower() for c in df.columns]
    if "symbol" not in df.columns:
        return []

    out: list[dict] = []
    for row in df.itertuples(index=False):
        symbol = str(getattr(row, "symbol", "")).upper().strip()
        if not symbol:
            continue
        name = str(getattr(row, "security", "")).strip() or symbol
        out.append({"symbol": symbol, "name": name, "asset_type": "stock", "market": "US"})
        if len(out) >= limit:
            break

    return out


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
    """Normalize Eastmoney numeric fields (string '-' -> None)."""
    if value in (None, "-", ""):
        return None
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _eastmoney_market_fs(market: Literal["us", "cn"]) -> str:
    """Map market code to Eastmoney fs expression."""
    if market == "us":
        return "m:105,m:106,m:107"
    return "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23"


def _fetch_eastmoney_snapshot(market: Literal["us", "cn"], limit: int) -> list[dict]:
    """Fetch market snapshot rows from Eastmoney."""
    import requests

    page_size = min(max(limit, 30), 2000)
    resp = requests.get(
        CN_STOCK_UNIVERSE_URL,
        params={
            "pn": 1,
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
    diff = payload.get("data", {}).get("diff", [])
    if not isinstance(diff, list):
        return []

    rows: list[dict] = []
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
        if len(rows) >= limit:
            break

    return rows


def fetch_stock_snapshot(market: Literal["us", "cn", "all"] = "us", limit: int = 100) -> list[dict]:
    """Fetch latest stock snapshot rows by market."""
    market_norm = market.lower().strip()
    if market_norm not in {"us", "cn", "all"} or limit <= 0:
        return []

    rows: list[dict] = []
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
        return rows[:limit]

    # Final fallback for US-only symbol discovery when Eastmoney is unavailable.
    if market_norm == "us":
        try:
            import requests

            resp = requests.get(
                US_STOCK_UNIVERSE_URL,
                timeout=10,
                headers={"User-Agent": "finance-platform/0.1"},
            )
            resp.raise_for_status()
            return _parse_sp500_constituents_csv(resp.text, limit)
        except Exception as exc:
            logger.warning("US fallback symbol universe fetch failed: %s", exc)

    if market_norm == "cn":
        return []

    # all-mode fallback: mix whatever can be fetched.
    fallback = fetch_stock_snapshot("us", limit)
    return fallback[:limit]


def fetch_stock_symbols(market: Literal["us", "cn", "all"] = "us", limit: int = 100) -> list[dict]:
    """Fetch latest stock symbols by market."""
    snapshots = fetch_stock_snapshot(market=market, limit=limit)
    return [
        {
            "symbol": row["symbol"],
            "name": row.get("name") or row["symbol"],
            "asset_type": "stock",
            "market": row.get("market", "US"),
        }
        for row in snapshots[:limit]
    ]


def detect_provider(symbol: str) -> tuple[str, str]:
    """Detect asset type and preferred data provider from symbol format.

    Returns:
        (asset_type, provider)
        asset_type: "stock" or "crypto"
        provider: "akshare" | "yfinance" | "coinbase"
    """
    s = symbol.upper().strip()

    # Crypto: direct symbol whitelist, or common USD/USDT quoted pairs.
    clean = s.replace("-USD", "").replace("-USDT", "")
    if clean in CRYPTO_SYMBOLS or s.endswith(("-USD", "-USDT")):
        return ("crypto", "coinbase")

    # CN/HK equity symbol heuristics.
    if s.endswith((".SZ", ".SH")) or (s.isdigit() and len(s) == 6):
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

    if provider == "coinbase":
        # coinbase uses base-USD pair format.
        base = s.replace("-USD", "").replace("-USDT", "")
        return f"{base}-USD"

    return s


def _interval_to_yfinance(interval: Literal["1d", "1W", "1M"]) -> str:
    """Map unified interval contract to yfinance interval syntax."""
    return {"1d": "1d", "1W": "1wk", "1M": "1mo"}[interval]


def _fetch_ohlcv_openbb(
    symbol: str,
    provider: str,
    asset_type: str,
    start_date: str,
    end_date: str,
    interval: Literal["1d", "1W", "1M"],
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
    interval: Literal["1d", "1W", "1M"],
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
        elif s.endswith(".HK"):
            yf_symbol = s
        elif s.isdigit() and len(s) == 6:
            yf_symbol = f"{s}.SS"

    # For crypto fallback use pair quote in USD.
    if provider == "coinbase":
        yf_symbol = normalize_symbol(yf_symbol, "coinbase")

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
    if provider == "coinbase":
        # Stooq has limited crypto coverage; keep the original token as-is.
        stooq_symbol = s.lower()
    elif s.endswith(".SZ"):
        stooq_symbol = f"{s.split('.')[0]}.cn"
    elif s.endswith(".SH") or (s.isdigit() and len(s) == 6):
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


def fetch_ohlcv(
    symbol: str,
    start_date: str,
    end_date: str,
    interval: Literal["1d", "1W", "1M"] = "1d",
) -> pd.DataFrame:
    """Fetch OHLCV history for stocks or crypto and return standardized columns.

    Args:
        symbol: e.g. "000001.SZ", "AAPL", "BTC", "BTC-USD".
        start_date: Inclusive start date in YYYY-MM-DD.
        end_date: Inclusive end date in YYYY-MM-DD.
        interval: "1d" | "1W" | "1M".

    Returns:
        DataFrame with columns: [time(UTC), open, high, low, close, volume].
        Returns empty DataFrame on failure.
    """
    asset_type, provider = detect_provider(symbol)
    normalized = normalize_symbol(symbol, provider)

    try:
        df = _fetch_ohlcv_openbb(
            symbol=normalized,
            provider=provider,
            asset_type=asset_type,
            start_date=start_date,
            end_date=end_date,
            interval=interval,
        )
    except Exception as exc:
        # Fallback keeps Step-5 gate deterministic even if OpenBB or upstream is flaky.
        logger.warning("OpenBB fetch_ohlcv failed for %s, fallback to yfinance: %s", symbol, exc)
        try:
            df = _fetch_ohlcv_yfinance(
                symbol=symbol,
                provider=provider,
                start_date=start_date,
                end_date=end_date,
                interval=interval,
            )
        except Exception as fallback_exc:
            logger.warning("yfinance fallback failed for %s: %s", symbol, fallback_exc)
            df = pd.DataFrame()

        if df.empty:
            try:
                # Second fallback for environments where Yahoo endpoints are blocked.
                df = _fetch_ohlcv_stooq(
                    symbol=symbol,
                    provider=provider,
                    start_date=start_date,
                    end_date=end_date,
                )
            except Exception as final_exc:
                logger.error("Stooq fallback failed for %s: %s", symbol, final_exc)
                return pd.DataFrame()

    return _normalize_ohlcv_frame(df, symbol)


def fetch_fundamentals(symbol: str) -> pd.DataFrame:
    """Fetch stock fundamentals (PE/PB/ROE and core metrics).

    Notes:
        This function is stock-only. Callers should avoid invoking it for crypto symbols.
    """
    _, provider = detect_provider(symbol)
    normalized = normalize_symbol(symbol, provider)

    try:
        if obb is None:
            raise RuntimeError("OpenBB SDK is unavailable")
        result = obb.equity.fundamental.metrics(normalized, provider=provider)
        return result.to_dataframe().reset_index()
    except Exception as exc:
        logger.warning("OpenBB fetch_fundamentals failed for %s: %s", symbol, exc)

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


def fetch_crypto_realtime_price(symbols: list[str]) -> dict:
    """Fetch real-time crypto prices from CoinGecko free endpoint.

    Returns:
        {"BTC": {"price": 65000.0, "change_pct_24h": 2.3}, ...}
    """
    import requests

    coingecko_ids = {
        "BTC": "bitcoin",
        "ETH": "ethereum",
        "BNB": "binancecoin",
        "SOL": "solana",
        "XRP": "ripple",
        "ADA": "cardano",
        "AVAX": "avalanche-2",
        "DOGE": "dogecoin",
        "DOT": "polkadot",
    }

    ids = ",".join([coingecko_ids.get(s.upper(), s.lower()) for s in symbols])

    try:
        resp = requests.get(
            "https://api.coingecko.com/api/v3/simple/price",
            params={
                "ids": ids,
                "vs_currencies": "usd",
                "include_24hr_change": "true",
            },
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()

        result: dict = {}
        for sym in symbols:
            coin_id = coingecko_ids.get(sym.upper(), sym.lower())
            if coin_id in data:
                result[sym] = {
                    "price": data[coin_id]["usd"],
                    "change_pct_24h": data[coin_id].get("usd_24h_change", 0),
                }
        return result
    except Exception as exc:
        logger.error("CoinGecko fetch failed: %s", exc)
        return {}
