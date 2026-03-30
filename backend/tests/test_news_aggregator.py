"""Unit tests for NewsAggregator source failure tolerance."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.services import news_aggregator


def _minimal_item(source: str, title: str) -> dict[str, object]:
    return {
        "source": source,
        "title": title,
        "content": "content",
        "url": "https://example.com/item",
        "published_at": "2026-03-30T09:30:00+08:00",
        "markets": ["cn"],
    }


def test_news_aggregator_fetch_continues_when_one_source_raises(monkeypatch) -> None:
    def _broken_handler(limit: int) -> list[dict[str, object]]:
        raise RuntimeError("eastmoney timeout")

    def _healthy_handler(limit: int) -> list[dict[str, object]]:
        return [_minimal_item("healthy_source", "Healthy headline")]

    monkeypatch.setattr(
        news_aggregator,
        "NEWS_SOURCES",
        [
            {"id": "eastmoney_notice_sz", "type": "handler", "markets": ["cn"], "handler": _broken_handler},
            {"id": "healthy_source", "type": "handler", "markets": ["cn"], "handler": _healthy_handler},
        ],
    )
    monkeypatch.setattr(
        news_aggregator,
        "resolve_symbols",
        lambda text_blob, default_market=None: ["000001.SZ"],
    )

    aggregator = news_aggregator.NewsAggregator()
    aggregator.sentiment.analyze = lambda content, title="": SimpleNamespace(  # type: ignore[method-assign]
        category="macro",
        score=0.12,
        importance=3,
        positive_hits=[],
        negative_hits=[],
    )

    items = aggregator.fetch(market="all", limit_per_source=5)

    assert len(items) == 1
    assert items[0]["title"] == "Healthy headline"
    assert items[0]["symbols"] == ["000001.SZ"]


def test_news_aggregator_fetch_and_store_reports_degraded_partial(monkeypatch) -> None:
    def _broken_handler(limit: int) -> list[dict[str, object]]:
        raise RuntimeError("eastmoney timeout")

    def _healthy_handler(limit: int) -> list[dict[str, object]]:
        return [_minimal_item("healthy_source", "Healthy headline")]

    async def _fake_persist(self, db, items):  # type: ignore[no-untyped-def]
        return {"inserted": len(items), "updated": 0}

    monkeypatch.setattr(
        news_aggregator,
        "NEWS_SOURCES",
        [
            {"id": "eastmoney_notice_sz", "type": "handler", "markets": ["cn"], "handler": _broken_handler},
            {"id": "healthy_source", "type": "handler", "markets": ["cn"], "handler": _healthy_handler},
        ],
    )
    monkeypatch.setattr(
        news_aggregator,
        "resolve_symbols",
        lambda text_blob, default_market=None: ["000001.SZ"],
    )
    monkeypatch.setattr(news_aggregator.NewsAggregator, "persist", _fake_persist)

    aggregator = news_aggregator.NewsAggregator()
    aggregator.sentiment.analyze = lambda content, title="": SimpleNamespace(  # type: ignore[method-assign]
        category="macro",
        score=0.12,
        importance=3,
        positive_hits=[],
        negative_hits=[],
    )

    result = asyncio.run(aggregator.fetch_and_store(db=object(), market="all", limit_per_source=5))

    assert result["count"] == 1
    assert result["inserted"] == 1
    assert result["updated"] == 0
    assert result["degraded"] is True
    assert result["partial"] is True
    assert result["sources_total"] == 2
    assert result["sources_succeeded"] == 1
    assert result["sources_failed"] == 1
    assert isinstance(result["source_errors"], list)
    assert result["source_errors"][0]["source_id"] == "eastmoney_notice_sz"
    assert result["source_errors"][0]["stage"] == "fetch"
