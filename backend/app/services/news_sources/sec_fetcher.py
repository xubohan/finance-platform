"""SEC feed adapters."""

from __future__ import annotations

from typing import Any

from app.services.news_sources.rss_fetcher import fetch_rss_feed


def fetch_8k(limit: int = 10) -> list[dict[str, Any]]:
    return fetch_rss_feed(
        source_id="sec_edgar_8k",
        url="https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&owner=include&output=atom",
        markets=["us"],
        limit=limit,
    )
