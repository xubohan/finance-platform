"""Social/news-community fetchers."""

from __future__ import annotations

from app.services.news_sources.rss_fetcher import fetch_rss_feed


def fetch_cryptopanic(limit: int = 10) -> list[dict]:
    return fetch_rss_feed(
        source_id="coindesk_rss",
        url="https://www.coindesk.com/arc/outboundfeeds/rss/",
        markets=["crypto"],
        limit=limit,
    )


def fetch_reddit(url: str, source_id: str, markets: list[str], limit: int = 10) -> list[dict]:
    return fetch_rss_feed(source_id=source_id, url=url, markets=markets, limit=limit)
