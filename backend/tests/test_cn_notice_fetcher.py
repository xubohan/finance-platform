"""Unit tests for CN announcement news-source fetchers."""

from __future__ import annotations

from datetime import date

import pytest

from app.services.news_sources import eastmoney_notice_fetcher
from app.services.news_sources.sse_fetcher import fetch as fetch_sse
from app.services.news_sources.szse_fetcher import fetch as fetch_szse


def _row(code: str, title: str, art_code: str, category: str = "重大事项") -> dict[str, object]:
    return {
        "art_code": art_code,
        "notice_date": date(2026, 3, 30),
        "title": title,
        "columns": [{"column_name": category}],
        "codes": [{"stock_code": code, "short_name": f"NAME-{code}"}],
    }


def test_fetch_sse_returns_only_shanghai_rows(monkeypatch) -> None:
    monkeypatch.setattr(eastmoney_notice_fetcher, "_date_candidates", lambda days=3: ["2026-03-30"])
    monkeypatch.setattr(
        eastmoney_notice_fetcher,
        "_fetch_notice_page",
        lambda **kwargs: [
            _row("688001", "KCB notice", "AN001"),
            _row("600519", "Mainboard notice", "AN002"),
            _row("000001", "SZ notice", "AN003"),
            _row("920068", "BJ notice", "AN004"),
        ],
    )

    items = fetch_sse(limit=5)

    assert [item["source_id"] for item in items] == ["AN001", "AN002"]
    assert all(item["source"] == "eastmoney_notice_sh" for item in items)
    assert all(item["markets"] == ["cn"] for item in items)
    assert items[0]["published_at"] == "2026-03-30T00:00:00+08:00"
    assert "688001" in str(items[0]["content"])


def test_fetch_szse_returns_only_shenzhen_rows(monkeypatch) -> None:
    monkeypatch.setattr(eastmoney_notice_fetcher, "_date_candidates", lambda days=3: ["2026-03-30"])
    monkeypatch.setattr(
        eastmoney_notice_fetcher,
        "_fetch_notice_page",
        lambda **kwargs: [
            _row("600000", "SH notice", "AN100"),
            _row("000001", "SZ mainboard notice", "AN101"),
            _row("301001", "ChiNext notice", "AN102"),
        ],
    )

    items = fetch_szse(limit=5)

    assert [item["source_id"] for item in items] == ["AN101", "AN102"]
    assert all(item["source"] == "eastmoney_notice_sz" for item in items)
    assert items[1]["url"] == "https://data.eastmoney.com/notices/detail/301001/AN102.html"


def test_fetchers_look_back_when_latest_date_is_empty(monkeypatch) -> None:
    calls: list[tuple[str, int, int]] = []

    def _fake_fetch_notice_page(*, date_str: str, page_index: int, page_size: int):
        calls.append((date_str, page_index, page_size))
        if date_str == "2026-03-30":
            return []
        return [_row("000333", "Fallback date notice", "AN201")]

    monkeypatch.setattr(eastmoney_notice_fetcher, "_date_candidates", lambda days=3: ["2026-03-30", "2026-03-29"])
    monkeypatch.setattr(eastmoney_notice_fetcher, "_fetch_notice_page", _fake_fetch_notice_page)

    items = fetch_szse(limit=1)

    assert [item["source_id"] for item in items] == ["AN201"]
    assert calls[0][0] == "2026-03-30"
    assert calls[1][0] == "2026-03-29"


def test_fetchers_continue_pagination_beyond_three_pages(monkeypatch) -> None:
    calls: list[int] = []
    page_size = 40

    def _fake_fetch_notice_page(*, date_str: str, page_index: int, page_size: int):
        assert date_str == "2026-03-30"
        calls.append(page_index)
        if page_index in (1, 2, 3):
            # Keep full page rows with non-target exchange codes so pagination continues.
            return [_row("600000", f"SH filler {page_index}-{idx}", f"FILL{page_index:02d}{idx:03d}") for idx in range(page_size)]
        if page_index == 4:
            return [_row("000001", "SZ page 4 notice", "AN401")]
        return []

    monkeypatch.setattr(eastmoney_notice_fetcher, "_date_candidates", lambda days=3: ["2026-03-30"])
    monkeypatch.setattr(eastmoney_notice_fetcher, "_fetch_notice_page", _fake_fetch_notice_page)

    items = fetch_szse(limit=1)

    assert [item["source_id"] for item in items] == ["AN401"]
    assert calls == [1, 2, 3, 4]


def test_fetchers_raise_when_mid_pagination_fails(monkeypatch) -> None:
    page_size = 40

    def _fake_fetch_notice_page(*, date_str: str, page_index: int, page_size: int):
        assert date_str == "2026-03-30"
        if page_index == 1:
            # First page is full so code attempts to pull the next page.
            return [_row("600000", f"SH filler {idx}", f"FILL{idx:03d}") for idx in range(page_size)]
        if page_index == 2:
            raise RuntimeError("upstream timeout")
        return []

    monkeypatch.setattr(eastmoney_notice_fetcher, "_date_candidates", lambda days=3: ["2026-03-30"])
    monkeypatch.setattr(eastmoney_notice_fetcher, "_fetch_notice_page", _fake_fetch_notice_page)

    with pytest.raises(eastmoney_notice_fetcher.EastmoneyNoticePaginationError) as exc_info:
        fetch_szse(limit=5)

    assert "exchange=sz" in str(exc_info.value)
    assert "date=2026-03-30" in str(exc_info.value)
    assert "page=2" in str(exc_info.value)
