"""Provider orchestration for realtime quote requests."""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import requests

from app.config import Settings, settings

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SEC = 5

_BINANCE_SYMBOLS = {
    "BTC": "BTCUSDT",
    "ETH": "ETHUSDT",
    "BNB": "BNBUSDT",
    "SOL": "SOLUSDT",
    "XRP": "XRPUSDT",
    "ADA": "ADAUSDT",
    "AVAX": "AVAXUSDT",
    "DOGE": "DOGEUSDT",
    "DOT": "DOTUSDT",
    "LINK": "LINKUSDT",
    "LTC": "LTCUSDT",
    "BCH": "BCHUSDT",
    "ATOM": "ATOMUSDT",
}

_KRAKEN_SYMBOLS = {
    "BTC": "XBTUSD",
    "ETH": "ETHUSD",
    "SOL": "SOLUSD",
    "XRP": "XRPUSD",
    "ADA": "ADAUSD",
    "AVAX": "AVAXUSD",
    "DOGE": "DOGEUSD",
    "DOT": "DOTUSD",
    "LINK": "LINKUSD",
    "LTC": "LTCUSD",
    "BCH": "BCHUSD",
    "ATOM": "ATOMUSD",
}

_COINBASE_SYMBOLS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    "BNB": "BNB-USD",
    "SOL": "SOL-USD",
    "XRP": "XRP-USD",
    "ADA": "ADA-USD",
    "AVAX": "AVAX-USD",
    "DOGE": "DOGE-USD",
    "DOT": "DOT-USD",
    "LINK": "LINK-USD",
    "LTC": "LTC-USD",
    "BCH": "BCH-USD",
    "ATOM": "ATOM-USD",
}

_COINGECKO_IDS = {
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
    "BCH": "bitcoin-cash",
    "ATOM": "cosmos",
}

_STOCK_FETCH_SOURCE_SEMANTICS: dict[str, tuple[str, bool]] = {
    "finnhub": ("live", False),
    "twelvedata": ("live", False),
    "tencent": ("live", False),
    "alphavantage_realtime": ("live", False),
    "alphavantage_delayed": ("delayed", True),
    "alphavantage_eod": ("eod", True),
    "yfinance": ("delayed", True),
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _to_float(value: Any) -> float | None:
    if value in (None, "", "-", "--"):
        return None
    try:
        return float(str(value).strip().replace("%", "").replace(",", ""))
    except (TypeError, ValueError):
        return None


def _to_iso_datetime(value: Any) -> str | None:
    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    if isinstance(value, str) and value.strip():
        raw = value.strip()
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat()
        except ValueError:
            for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
                try:
                    parsed = datetime.strptime(raw, fmt)
                    return parsed.replace(tzinfo=timezone.utc).isoformat()
                except ValueError:
                    continue
            for fmt in ("%Y%m%d", "%Y%m%d%H%M%S"):
                try:
                    parsed = datetime.strptime(raw, fmt)
                    return parsed.replace(tzinfo=timezone.utc).isoformat()
                except ValueError:
                    continue
    return None


def _normalize_yfinance_symbol(symbol: str) -> str:
    normalized = symbol.upper().strip()
    if normalized.endswith(".SH"):
        return f"{normalized.split('.')[0]}.SS"
    return normalized


def _tencent_symbol(symbol: str) -> str | None:
    normalized = symbol.upper().strip()
    if not normalized:
        return None
    if normalized.endswith(".SH"):
        return f"sh{normalized.split('.', 1)[0]}"
    if normalized.endswith(".SZ"):
        return f"sz{normalized.split('.', 1)[0]}"
    if normalized.endswith(".BJ"):
        return f"bj{normalized.split('.', 1)[0]}"
    return f"us{normalized.replace('-', '.')}"


def _parse_tencent_as_of(symbol: str, raw: Any) -> str | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    normalized = symbol.upper().strip()
    raw_value = raw.strip()
    market_tz = ZoneInfo("Asia/Shanghai") if normalized.endswith((".SH", ".SZ", ".BJ")) else ZoneInfo("America/New_York")
    formats = ("%Y-%m-%d %H:%M:%S", "%Y%m%d%H%M%S", "%Y%m%d")
    for fmt in formats:
        try:
            parsed = datetime.strptime(raw_value, fmt)
            return parsed.replace(tzinfo=market_tz).astimezone(timezone.utc).isoformat()
        except ValueError:
            continue
    return _to_iso_datetime(raw)


def _pct_change(latest: float | None, baseline: float | None) -> float | None:
    if latest in (None, 0) or baseline in (None, 0):
        return None
    return round((float(latest) - float(baseline)) / float(baseline) * 100, 6)


def _parse_order(raw: Any, default: tuple[str, ...], allowed: tuple[str, ...]) -> list[str]:
    if isinstance(raw, str):
        items = [item.strip().lower() for item in raw.split(",") if item.strip()]
    else:
        items = []
    out = [item for item in items if item in allowed]
    if not out:
        return list(default)
    deduped: list[str] = []
    seen: set[str] = set()
    for item in out:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    return deduped


def _stock_source_semantics(fetch_source: str) -> tuple[str, bool]:
    return _STOCK_FETCH_SOURCE_SEMANTICS.get(fetch_source, ("delayed", True))


class QuoteProviderController:
    """Live quote orchestration for public crypto feeds and keyed stock APIs."""

    def __init__(self, runtime_settings: Settings | None = None) -> None:
        self.settings = runtime_settings or settings

    def _cfg(self, primary: str, legacy: str | None = None, default: Any = None) -> Any:
        value = getattr(self.settings, primary, None)
        if value not in (None, ""):
            return value
        if legacy:
            legacy_value = getattr(self.settings, legacy, None)
            if legacy_value not in (None, ""):
                return legacy_value
        return default

    def _request_json(self, url: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
        timeout = float(self._cfg("quote_provider_timeout_sec", default=_REQUEST_TIMEOUT_SEC) or _REQUEST_TIMEOUT_SEC)
        user_agent = str(self._cfg("quote_provider_user_agent", default="finance-platform/0.1"))
        resp = requests.get(
            url,
            params=params,
            headers=headers or {"User-Agent": user_agent},
            timeout=max(1.0, timeout),
        )
        resp.raise_for_status()
        return resp.json()

    def _alphavantage_api_url(self) -> str:
        raw = str(self.settings.alphavantage_base_url or "https://www.alphavantage.co/query").rstrip("/")
        parsed = urlsplit(raw)
        if parsed.path in ("", "/"):
            return urlunsplit((parsed.scheme, parsed.netloc, "/query", parsed.query, parsed.fragment))
        return raw

    def _finnhub_quote_url(self) -> str:
        raw = str(self._cfg("finnhub_base_url", default="https://finnhub.io/api/v1")).rstrip("/")
        parsed = urlsplit(raw)
        path = parsed.path.rstrip("/")
        if path in ("", "/"):
            path = "/api/v1/quote"
        elif path.endswith("/api/v1"):
            path = f"{path}/quote"
        elif not path.endswith("/quote"):
            path = f"{path}/quote"
        return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))

    def _tencent_quote_url(self) -> str:
        raw = str(self._cfg("tencent_quote_base_url", default="https://qt.gtimg.cn/q=")).strip()
        if not raw:
            return "https://qt.gtimg.cn/q="
        return raw

    def _fetch_binance_crypto_quote(self, symbol: str) -> dict[str, Any]:
        pair = _BINANCE_SYMBOLS.get(symbol)
        if not pair:
            return {}
        try:
            base_url = str(self._cfg("crypto_binance_base_url", "binance_base_url", "https://api.binance.com")).rstrip("/")
            payload = self._request_json(f"{base_url}/api/v3/ticker/24hr", params={"symbol": pair})
        except Exception as exc:
            logger.warning("Binance crypto quote failed symbol=%s error=%s", symbol, exc)
            return {}

        price = _to_float(payload.get("lastPrice"))
        change_pct = _to_float(payload.get("priceChangePercent"))
        if price is None:
            return {}
        return {
            "symbol": symbol,
            "price": price,
            "change_pct_24h": change_pct or 0.0,
            "provider": "binance",
            "fetch_source": "binance",
            "source": "live",
            "stale": False,
            "as_of": _to_iso_datetime((payload.get("closeTime") or 0) / 1000) or _utc_now_iso(),
        }

    def _fetch_kraken_crypto_quote(self, symbol: str) -> dict[str, Any]:
        pair = _KRAKEN_SYMBOLS.get(symbol)
        if not pair:
            return {}
        try:
            base_url = str(self._cfg("crypto_kraken_base_url", "kraken_base_url", "https://api.kraken.com")).rstrip("/")
            payload = self._request_json(f"{base_url}/0/public/Ticker", params={"pair": pair})
        except Exception as exc:
            logger.warning("Kraken crypto quote failed symbol=%s error=%s", symbol, exc)
            return {}

        result = payload.get("result") or {}
        if not isinstance(result, dict) or not result:
            return {}
        ticker = next(iter(result.values()))
        if not isinstance(ticker, dict):
            return {}

        last = _to_float((ticker.get("c") or [None])[0])
        opened = _to_float(ticker.get("o"))
        if last is None:
            return {}
        return {
            "symbol": symbol,
            "price": last,
            "change_pct_24h": _pct_change(last, opened) or 0.0,
            "provider": "kraken",
            "fetch_source": "kraken",
            "source": "live",
            "stale": False,
            "as_of": _utc_now_iso(),
        }

    def _fetch_coinbase_crypto_quote(self, symbol: str) -> dict[str, Any]:
        product_id = _COINBASE_SYMBOLS.get(symbol)
        if not product_id:
            return {}
        base_url = str(self._cfg("crypto_coinbase_base_url", "coinbase_base_url", "https://api.exchange.coinbase.com")).rstrip("/")
        try:
            ticker = self._request_json(f"{base_url}/products/{product_id}/ticker")
            stats = self._request_json(f"{base_url}/products/{product_id}/stats")
        except Exception as exc:
            logger.warning("Coinbase crypto quote failed symbol=%s error=%s", symbol, exc)
            return {}

        price = _to_float(ticker.get("price"))
        opened = _to_float(stats.get("open"))
        if price is None:
            return {}
        return {
            "symbol": symbol,
            "price": price,
            "change_pct_24h": _pct_change(price, opened) or 0.0,
            "provider": "coinbase",
            "fetch_source": "coinbase",
            "source": "live",
            "stale": False,
            "as_of": _to_iso_datetime(ticker.get("time")) or _utc_now_iso(),
        }

    def _fetch_coingecko_crypto_quote(self, symbol: str) -> dict[str, Any]:
        coin_id = _COINGECKO_IDS.get(symbol, symbol.lower())
        try:
            payload = self._request_json(
                f"{str(self._cfg('crypto_coingecko_base_url', 'coingecko_base_url', 'https://api.coingecko.com')).rstrip('/')}/api/v3/simple/price",
                params={
                    "ids": coin_id,
                    "vs_currencies": "usd",
                    "include_24hr_change": "true",
                },
            )
        except Exception as exc:
            logger.warning("CoinGecko crypto quote failed symbol=%s error=%s", symbol, exc)
            return {}

        item = payload.get(coin_id) if isinstance(payload, dict) else None
        if not isinstance(item, dict):
            return {}
        price = _to_float(item.get("usd"))
        if price is None:
            return {}
        return {
            "symbol": symbol,
            "price": price,
            "change_pct_24h": _to_float(item.get("usd_24h_change")) or 0.0,
            "provider": "coingecko",
            "fetch_source": "coingecko",
            "source": "live",
            "stale": False,
            "as_of": _utc_now_iso(),
        }

    def fetch_crypto_quote(self, symbol: str) -> dict[str, Any]:
        normalized = symbol.upper().strip()
        fetcher_map = {
            "binance": self._fetch_binance_crypto_quote,
            "kraken": self._fetch_kraken_crypto_quote,
            "coinbase": self._fetch_coinbase_crypto_quote,
            "coingecko": self._fetch_coingecko_crypto_quote,
        }
        order = _parse_order(
            self._cfg("crypto_quote_provider_order", default=""),
            default=("binance", "kraken", "coinbase", "coingecko"),
            allowed=("binance", "kraken", "coinbase", "coingecko"),
        )
        for provider in order:
            fetcher = fetcher_map[provider]
            payload = fetcher(normalized)
            if payload.get("price") not in (None, 0):
                return payload
        return {}

    def fetch_crypto_quotes(self, symbols: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for symbol in symbols:
            normalized = str(symbol or "").upper().strip()
            if not normalized:
                continue
            payload = self.fetch_crypto_quote(normalized)
            if payload.get("price") not in (None, 0):
                out[normalized] = payload
        return out

    def _fetch_twelvedata_stock_quote(self, symbol: str) -> dict[str, Any]:
        if not self.settings.twelvedata_api_key:
            return {}
        try:
            payload = self._request_json(
                f"{self.settings.twelvedata_base_url.rstrip('/')}/quote",
                params={"symbol": symbol, "apikey": self.settings.twelvedata_api_key},
            )
        except Exception as exc:
            logger.warning("Twelve Data stock quote failed symbol=%s error=%s", symbol, exc)
            return {}

        if not isinstance(payload, dict) or payload.get("status") == "error":
            return {}

        price = _to_float(payload.get("close") or payload.get("price"))
        previous_close = _to_float(payload.get("previous_close"))
        change_pct = _to_float(payload.get("percent_change") or payload.get("change_percent"))
        if price is None:
            return {}
        source, stale = _stock_source_semantics("twelvedata")
        return {
            "symbol": symbol,
            "price": price,
            "change_pct_24h": change_pct if change_pct is not None else (_pct_change(price, previous_close) or 0.0),
            "provider": "twelvedata",
            "fetch_source": "twelvedata",
            "source": source,
            "stale": stale,
            "as_of": _to_iso_datetime(payload.get("datetime") or payload.get("timestamp")),
        }

    def _fetch_finnhub_stock_quote(self, symbol: str) -> dict[str, Any]:
        if not self.settings.finnhub_api_key:
            return {}
        try:
            payload = self._request_json(
                self._finnhub_quote_url(),
                params={"symbol": symbol, "token": self.settings.finnhub_api_key},
            )
        except Exception as exc:
            logger.warning("Finnhub stock quote failed symbol=%s error=%s", symbol, exc)
            return {}

        if not isinstance(payload, dict):
            return {}

        price = _to_float(payload.get("c"))
        previous_close = _to_float(payload.get("pc"))
        change_pct = _to_float(payload.get("dp"))
        if price in (None, 0):
            return {}
        source, stale = _stock_source_semantics("finnhub")
        return {
            "symbol": symbol,
            "price": price,
            "change_pct_24h": change_pct if change_pct is not None else (_pct_change(price, previous_close) or 0.0),
            "provider": "finnhub",
            "fetch_source": "finnhub",
            "source": source,
            "stale": stale,
            "as_of": _to_iso_datetime(payload.get("t")) or _utc_now_iso(),
        }

    def _fetch_tencent_stock_quote(self, symbol: str) -> dict[str, Any]:
        token = _tencent_symbol(symbol)
        if not token:
            return {}
        try:
            resp = requests.get(
                f"{self._tencent_quote_url()}{token}",
                timeout=max(1.0, float(self._cfg("quote_provider_timeout_sec", default=_REQUEST_TIMEOUT_SEC) or _REQUEST_TIMEOUT_SEC)),
                headers={
                    "User-Agent": str(self._cfg("quote_provider_user_agent", default="finance-platform/0.1")),
                    "Referer": "https://gu.qq.com/",
                },
            )
            resp.raise_for_status()
        except Exception as exc:
            logger.warning("Tencent stock quote failed symbol=%s error=%s", symbol, exc)
            return {}

        body = resp.text.strip()
        prefix = f"v_{token}="
        if not body.startswith(prefix) or '="' not in body:
            return {}
        raw_payload = body.split('="', 1)[1].rsplit('";', 1)[0]
        if not raw_payload:
            return {}
        parts = raw_payload.split("~")
        if len(parts) < 33:
            return {}

        price = _to_float(parts[3] if len(parts) > 3 else None)
        previous_close = _to_float(parts[4] if len(parts) > 4 else None)
        change_pct = _to_float(parts[32] if len(parts) > 32 else None)
        as_of = _parse_tencent_as_of(symbol, parts[30] if len(parts) > 30 else None) or _utc_now_iso()
        if price is None:
            return {}
        source, stale = _stock_source_semantics("tencent")
        return {
            "symbol": symbol,
            "price": price,
            "change_pct_24h": change_pct if change_pct is not None else (_pct_change(price, previous_close) or 0.0),
            "provider": "tencent",
            "fetch_source": "tencent",
            "source": source,
            "stale": stale,
            "as_of": as_of,
        }

    def _fetch_alpha_vantage_stock_quote(self, symbol: str) -> dict[str, Any]:
        if not self.settings.alphavantage_api_key:
            return {}
        entitlement = str(getattr(self.settings, "alphavantage_entitlement", "") or "").strip().lower()
        params = {
            "function": "GLOBAL_QUOTE",
            "symbol": symbol,
            "apikey": self.settings.alphavantage_api_key,
        }
        if entitlement:
            params["entitlement"] = entitlement
        try:
            payload = self._request_json(
                self._alphavantage_api_url(),
                params=params,
            )
        except Exception as exc:
            logger.warning("Alpha Vantage stock quote failed symbol=%s error=%s", symbol, exc)
            return {}

        quote = payload.get("Global Quote") if isinstance(payload, dict) else None
        if not isinstance(quote, dict) or not quote:
            return {}

        price = _to_float(quote.get("05. price"))
        if price is None:
            return {}
        fetch_source = "alphavantage"
        if entitlement == "realtime":
            fetch_source = "alphavantage_realtime"
        elif entitlement == "delayed":
            fetch_source = "alphavantage_delayed"
        else:
            fetch_source = "alphavantage_eod"
        source, stale = _stock_source_semantics(fetch_source)
        return {
            "symbol": symbol,
            "price": price,
            "change_pct_24h": _to_float(quote.get("10. change percent")) or 0.0,
            "provider": "alphavantage",
            "fetch_source": fetch_source,
            "source": source,
            "stale": stale,
            "as_of": _to_iso_datetime(quote.get("07. latest trading day")),
        }

    def _fetch_yfinance_stock_quote(self, symbol: str) -> dict[str, Any]:
        try:
            import yfinance as yf
        except Exception as exc:  # pragma: no cover - import guard
            logger.warning("yfinance stock quote import failed symbol=%s error=%s", symbol, exc)
            return {}

        ticker = yf.Ticker(_normalize_yfinance_symbol(symbol))
        price: float | None = None
        previous_close: float | None = None
        as_of: str | None = None

        try:
            fast_info = getattr(ticker, "fast_info", {}) or {}
            if not isinstance(fast_info, dict):
                fast_info = dict(fast_info)
        except Exception as exc:
            logger.warning("yfinance fast_info quote failed symbol=%s error=%s", symbol, exc)
            fast_info = {}

        price = _to_float(
            fast_info.get("lastPrice")
            or fast_info.get("last_price")
            or fast_info.get("regularMarketPrice")
        )
        previous_close = _to_float(
            fast_info.get("previousClose")
            or fast_info.get("previous_close")
            or fast_info.get("regularMarketPreviousClose")
        )
        as_of = _to_iso_datetime(
            fast_info.get("lastPriceTimestamp")
            or fast_info.get("last_price_time")
            or fast_info.get("regularMarketTime")
        )

        if price is None:
            try:
                info = ticker.info or {}
            except Exception as exc:
                logger.warning("yfinance info quote failed symbol=%s error=%s", symbol, exc)
                info = {}
            if isinstance(info, dict):
                price = _to_float(info.get("regularMarketPrice") or info.get("currentPrice"))
                previous_close = previous_close or _to_float(
                    info.get("regularMarketPreviousClose") or info.get("previousClose")
                )
                as_of = as_of or _to_iso_datetime(info.get("regularMarketTime"))

        if price is None:
            return {}

        source, stale = _stock_source_semantics("yfinance")
        return {
            "symbol": symbol,
            "price": price,
            "change_pct_24h": _pct_change(price, previous_close) or 0.0,
            "provider": "yfinance",
            "fetch_source": "yfinance",
            "source": source,
            "stale": stale,
            "as_of": as_of,
        }

    def fetch_stock_quote(self, symbol: str) -> dict[str, Any]:
        normalized = symbol.upper().strip()
        fetcher_map = {
            "finnhub": self._fetch_finnhub_stock_quote,
            "twelvedata": self._fetch_twelvedata_stock_quote,
            "tencent": self._fetch_tencent_stock_quote,
            "yfinance": self._fetch_yfinance_stock_quote,
            "alphavantage": self._fetch_alpha_vantage_stock_quote,
        }
        order = _parse_order(
            self._cfg("stock_quote_provider_order", default=""),
            default=("finnhub", "twelvedata", "tencent", "yfinance", "alphavantage"),
            allowed=("finnhub", "twelvedata", "tencent", "yfinance", "alphavantage"),
        )
        for provider in order:
            fetcher = fetcher_map[provider]
            payload = fetcher(normalized)
            if payload.get("price") not in (None, 0):
                return payload
        return {}


_controller = QuoteProviderController()


def fetch_crypto_realtime_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    return _controller.fetch_crypto_quotes(symbols)


def fetch_stock_realtime_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for symbol in symbols:
        normalized = str(symbol or "").upper().strip()
        if not normalized:
            continue
        payload = _controller.fetch_stock_quote(normalized)
        if payload.get("price") not in (None, 0):
            out[normalized] = payload
    return out


def fetch_realtime_quotes(symbols: list[str], asset_type: str) -> dict[str, dict[str, Any]]:
    kind = str(asset_type or "").lower().strip()
    if kind == "crypto":
        return fetch_crypto_realtime_quotes(symbols)
    return fetch_stock_realtime_quotes(symbols)
