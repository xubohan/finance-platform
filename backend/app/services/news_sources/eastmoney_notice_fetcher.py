"""A-share announcement fetch helper backed by Eastmoney's public notice API."""

from __future__ import annotations

from datetime import date, datetime, timedelta
import hashlib
import logging
import re
from typing import Any, Literal
from zoneinfo import ZoneInfo

import httpx


logger = logging.getLogger(__name__)

EASTMONEY_NOTICE_URL = "https://np-anotice-stock.eastmoney.com/api/security/ann"
_SH_TZ = ZoneInfo("Asia/Shanghai")
_SH_PREFIXES = ("600", "601", "603", "605", "688", "689", "900")
_SZ_PREFIXES = ("000", "001", "002", "003", "004", "200", "300", "301")
_CODE_PATTERN = re.compile(r"^\d{6}$")


class EastmoneyNoticePaginationError(RuntimeError):
    """Raised when notice pagination fails before completing current-day scan."""

    def __init__(self, *, exchange: str, date_str: str, page_index: int, cause: Exception) -> None:
        self.exchange = exchange
        self.date_str = date_str
        self.page_index = page_index
        self.cause = cause
        super().__init__(f"eastmoney notice pagination failed exchange={exchange} date={date_str} page={page_index}: {cause}")


def _date_candidates(days: int = 3) -> list[str]:
    today = datetime.now(_SH_TZ).date()
    return [(today - timedelta(days=offset)).strftime("%Y-%m-%d") for offset in range(max(days, 1))]


def _is_exchange_code(code: str, exchange: Literal["sh", "sz"]) -> bool:
    if not _CODE_PATTERN.fullmatch(code):
        return False
    prefixes = _SH_PREFIXES if exchange == "sh" else _SZ_PREFIXES
    return code.startswith(prefixes)


def _notice_timestamp(value: Any) -> str:
    if isinstance(value, date):
        notice_date = value
    elif isinstance(value, str) and value.strip():
        raw = value.strip()
        if len(raw) == 10:
            notice_date = datetime.strptime(raw, "%Y-%m-%d").date()
        else:
            notice_date = datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(_SH_TZ).date()
    else:
        notice_date = datetime.now(_SH_TZ).date()
    return datetime.combine(notice_date, datetime.min.time(), tzinfo=_SH_TZ).isoformat()


def _notice_url(code: str, art_code: str | None) -> str | None:
    if not code or not art_code:
        return None
    return f"https://data.eastmoney.com/notices/detail/{code}/{art_code}.html"


def _content_hash(title: str, url: str | None) -> str:
    return hashlib.sha256(f"{title}|{url or ''}".encode("utf-8")).hexdigest()[:24]


def _fetch_notice_page(*, date_str: str, page_index: int, page_size: int) -> list[dict[str, Any]]:
    params = {
        "sr": "-1",
        "page_size": str(page_size),
        "page_index": str(page_index),
        "ann_type": "A",
        "client_source": "web",
        "f_node": "0",
        "s_node": "0",
        "begin_time": date_str,
        "end_time": date_str,
    }
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Referer": "https://data.eastmoney.com/notices/",
        "Accept": "application/json, text/plain, */*",
    }
    with httpx.Client(timeout=15.0, follow_redirects=True, headers=headers) as client:
        response = client.get(EASTMONEY_NOTICE_URL, params=params)
        response.raise_for_status()
        payload = response.json()
    return payload.get("data", {}).get("list") or []


def _normalize_notice_item(row: dict[str, Any], *, source: str) -> dict[str, Any] | None:
    codes = row.get("codes") or []
    code_payload = codes[0] if isinstance(codes, list) and codes else {}
    code = str(code_payload.get("stock_code") or row.get("stock_code") or "").strip()
    if not _CODE_PATTERN.fullmatch(code):
        return None
    title = str(row.get("title") or "").strip()
    if not title:
        return None
    art_code = str(row.get("art_code") or "").strip() or None
    name = str(code_payload.get("short_name") or row.get("short_name") or "").strip()
    category = str((row.get("columns") or [{}])[0].get("column_name") or row.get("column_name") or "").strip()
    url = _notice_url(code, art_code)
    return {
        "source": source,
        "source_id": art_code or _content_hash(title, url),
        "title": title,
        "content": " ".join(part for part in [code, name, category] if part),
        "url": url,
        "published_at": _notice_timestamp(row.get("notice_date") or row.get("display_time")),
        "markets": ["cn"],
    }


def fetch_exchange_announcements(*, exchange: Literal["sh", "sz"], source_id: str, limit: int = 10) -> list[dict[str, Any]]:
    wanted = max(1, min(limit, 50))
    page_size = min(max(wanted * 4, 40), 100)
    seen: set[str] = set()
    items: list[dict[str, Any]] = []

    for date_str in _date_candidates():
        page_index = 1
        while True:
            try:
                rows = _fetch_notice_page(date_str=date_str, page_index=page_index, page_size=page_size)
            except Exception as exc:
                logger.warning("eastmoney notice fetch failed exchange=%s date=%s page=%s: %s", exchange, date_str, page_index, exc)
                raise EastmoneyNoticePaginationError(
                    exchange=exchange,
                    date_str=date_str,
                    page_index=page_index,
                    cause=exc,
                ) from exc
            if not rows:
                break
            for row in rows:
                code_payload = (row.get("codes") or [{}])[0]
                code = str(code_payload.get("stock_code") or row.get("stock_code") or "").strip()
                if not _is_exchange_code(code, exchange):
                    continue
                normalized = _normalize_notice_item(row, source=source_id)
                if not normalized:
                    continue
                unique_key = str(normalized["source_id"])
                if unique_key in seen:
                    continue
                seen.add(unique_key)
                items.append(normalized)
                if len(items) >= wanted:
                    return items
            if len(rows) < page_size:
                break
            page_index += 1
    return items
