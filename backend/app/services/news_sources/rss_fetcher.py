"""Generic RSS and Atom fetcher."""

from __future__ import annotations

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

try:
    import feedparser
except Exception:  # pragma: no cover - host-local test env may omit dependency
    feedparser = None


def _to_iso(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat()
        except Exception:
            return value
    return datetime.now(timezone.utc).isoformat()


def fetch_rss_feed(*, source_id: str, url: str, markets: list[str], limit: int = 10) -> list[dict[str, Any]]:
    if feedparser is None:
        return []
    feed = feedparser.parse(url)
    if getattr(feed, "bozo", 0) and not getattr(feed, "entries", []):
        return []

    items: list[dict[str, Any]] = []
    for entry in feed.entries[:limit]:
        title = getattr(entry, "title", "") or ""
        summary = getattr(entry, "summary", "") or getattr(entry, "description", "") or ""
        published_raw = getattr(entry, "published", "") or getattr(entry, "updated", "")
        items.append(
            {
                "source": source_id,
                "source_id": getattr(entry, "id", None) or getattr(entry, "link", None),
                "title": title.strip(),
                "content": summary.strip(),
                "url": getattr(entry, "link", None),
                "published_at": _to_iso(published_raw),
                "markets": markets,
            }
        )
    return [item for item in items if item["title"]]
