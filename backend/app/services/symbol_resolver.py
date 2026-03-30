"""Best-effort symbol resolver for news and event text."""

from __future__ import annotations

import re


US_TICKER_RE = re.compile(r"(?<![A-Z0-9.])([A-Z]{2,5})(?![A-Z0-9.])")
US_CASH_TICKER_RE = re.compile(r"(?<![A-Z0-9])\$([A-Za-z]{1,5})(?![A-Za-z0-9])")
US_EXCHANGE_TICKER_RE = re.compile(
    r"(?<![A-Z0-9])(?:NASDAQ|NYSE|NYSEARCA|NYSEAMERICAN|AMEX)[:\s]+([A-Z]{1,5})(?![A-Z0-9])",
    re.IGNORECASE,
)
CN_TICKER_RE = re.compile(r"(?<!\d)(\d{6})(?!\d)")
EXPLICIT_CN_RE = re.compile(r"(?<![A-Z0-9])(\d{6}\.(?:SH|SZ|BJ))(?![A-Z0-9])", re.IGNORECASE)
CRYPTO_ALIASES = {
    "BTC": "BTC",
    "BITCOIN": "BTC",
    "ETH": "ETH",
    "ETHEREUM": "ETH",
    "SOL": "SOL",
    "DOGE": "DOGE",
    "XRP": "XRP",
    "BNB": "BNB",
}
STOPWORDS = {
    "A",
    "ABOUT",
    "AFTER",
    "AI",
    "AND",
    "ARE",
    "BEFORE",
    "CEO",
    "CPI",
    "EPS",
    "ETF",
    "FED",
    "FOR",
    "FROM",
    "INTO",
    "IPO",
    "LIVE",
    "NEWS",
    "PMI",
    "SAID",
    "SEC",
    "SHARES",
    "STOCK",
    "THE",
    "UPDATE",
    "USD",
    "US",
    "WILL",
    "WITH",
}
CRYPTO_ALIAS_PATTERNS = {
    alias: re.compile(rf"(?<![A-Z0-9]){re.escape(alias)}(?![A-Z0-9])")
    for alias in CRYPTO_ALIASES
}


def resolve_symbols(text: str, *, default_market: str | None = None) -> list[str]:
    symbols: list[str] = []
    seen: set[str] = set()
    raw_text = text or ""
    upper_text = text.upper()

    for match in EXPLICIT_CN_RE.findall(upper_text):
        if match not in seen:
            seen.add(match)
            symbols.append(match)

    for code in CN_TICKER_RE.findall(upper_text):
        normalized = f"{code}.SH" if code.startswith(("5", "6", "9")) else f"{code}.SZ"
        if normalized not in seen:
            seen.add(normalized)
            symbols.append(normalized)

    for alias, normalized in CRYPTO_ALIASES.items():
        if CRYPTO_ALIAS_PATTERNS[alias].search(upper_text) and normalized not in seen:
            seen.add(normalized)
            symbols.append(normalized)

    for match in US_EXCHANGE_TICKER_RE.finditer(raw_text):
        ticker = (match.group(1) or "").upper()
        if ticker in STOPWORDS or ticker in seen:
            continue
        if default_market == "cn" and len(ticker) > 3:
            continue
        seen.add(ticker)
        symbols.append(ticker)

    for match in re.finditer(r"\$([A-Za-z]{1,5})|(?<![A-Z0-9.])([A-Z]{2,5})(?![A-Z0-9.])", raw_text):
        ticker = (match.group(1) or match.group(2) or "").upper()
        if ticker in STOPWORDS or ticker in seen:
            continue
        if default_market == "cn" and len(ticker) > 3:
            continue
        seen.add(ticker)
        symbols.append(ticker)

    return symbols[:12]
