"""Shanghai exchange announcement fetcher."""

from __future__ import annotations

from app.services.news_sources.eastmoney_notice_fetcher import fetch_exchange_announcements


def fetch(limit: int = 10) -> list[dict]:
    return fetch_exchange_announcements(exchange="sh", source_id="eastmoney_notice_sh", limit=limit)
