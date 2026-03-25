"""Contract tests for /api/v2/news routes."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.api.v2 import news as news_v2

from tests._v2_testutils import FakeResult, QueueAsyncSession, make_client


def test_v2_news_feed_filters_and_meta_distribution(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fail_fetch_and_store(*args, **kwargs):  # pragma: no cover - assertion guard
        raise AssertionError("fetch_and_store should not run when news table already has rows")

    monkeypatch.setattr(news_v2.aggregator, "fetch_and_store", _fail_fetch_and_store)
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "id": 1,
                        "title": "Fed keeps rates unchanged",
                        "source": "reuters_rss",
                        "published_at": datetime(2026, 3, 25, 10, 0, tzinfo=timezone.utc),
                        "symbols": ["SPY"],
                        "categories": ["macro"],
                        "markets": ["us"],
                        "sentiment": 0.52,
                        "importance": 5,
                        "llm_summary": "summary-1",
                        "llm_impact": "impact-1",
                        "url": "https://example.com/1",
                    },
                    {
                        "id": 2,
                        "title": "Policy headline",
                        "source": "sec_feed",
                        "published_at": datetime(2026, 3, 25, 9, 0, tzinfo=timezone.utc),
                        "symbols": ["AAPL"],
                        "categories": ["policy"],
                        "markets": ["us"],
                        "sentiment": 0.0,
                        "importance": 3,
                        "llm_summary": "summary-2",
                        "llm_impact": "impact-2",
                        "url": "https://example.com/2",
                    },
                    {
                        "id": 3,
                        "title": "Risk-off sentiment",
                        "source": "social_feed",
                        "published_at": datetime(2026, 3, 25, 8, 0, tzinfo=timezone.utc),
                        "symbols": ["QQQ"],
                        "categories": ["macro"],
                        "markets": ["us"],
                        "sentiment": -0.34,
                        "importance": 4,
                        "llm_summary": "summary-3",
                        "llm_impact": "impact-3",
                        "url": "https://example.com/3",
                    },
                ]
            ),
            FakeResult(scalar=42),
        ]
    )
    client = make_client(db_session=session)

    resp = client.get(
        "/api/v2/news/feed",
        params={
            "market": "us",
            "query": "  fed rate  ",
            "symbols": "aapl,msft",
            "category": "macro,policy",
            "sentiment": "positive",
            "importance": 3,
            "page": 2,
            "page_size": 3,
        },
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["count"] == 3
    assert payload["meta"]["total"] == 42
    assert payload["meta"]["page"] == 2
    assert payload["meta"]["page_size"] == 3
    assert payload["meta"]["sentiment_distribution"] == {
        "positive": 1,
        "neutral": 1,
        "negative": 1,
    }
    assert payload["data"][0]["title"] == "Fed keeps rates unchanged"

    first_call_params = session.calls[0]["params"]
    assert first_call_params["market"] == "us"
    assert first_call_params["query"] == "%fed rate%"
    assert first_call_params["symbols"] == ["AAPL", "MSFT"]
    assert first_call_params["categories"] == ["macro", "policy"]
    assert first_call_params["importance"] == 3
    assert first_call_params["offset"] == 3
    assert first_call_params["page_size"] == 3
    assert first_call_params["sentiment_threshold"] == 0.15


def test_v2_news_detail_not_found_returns_404() -> None:
    session = QueueAsyncSession([FakeResult(rows=[])])
    client = make_client(db_session=session)

    resp = client.get("/api/v2/news/999")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"]["code"] == "NOT_FOUND"


def test_v2_news_detail_returns_data() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "id": 101,
                        "source": "rss",
                        "source_id": "abc",
                        "title": "Headline",
                        "content": "Body",
                        "url": "https://example.com/101",
                        "published_at": datetime(2026, 3, 25, 11, 0, tzinfo=timezone.utc),
                        "symbols": ["TSLA"],
                        "categories": ["macro"],
                        "markets": ["us"],
                        "sentiment": 0.2,
                        "importance": 4,
                        "llm_summary": "summary",
                        "llm_impact": "impact",
                        "llm_key_factors": ["factor1"],
                        "processed": True,
                        "created_at": datetime(2026, 3, 25, 11, 1, tzinfo=timezone.utc),
                    }
                ]
            )
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/news/101")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"]["id"] == 101
    assert payload["data"]["symbols"] == ["TSLA"]
    assert "generated_at" in payload["meta"]


def test_v2_news_stats_returns_weekly_distribution() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "total": 33,
                        "positive_count": 10,
                        "negative_count": 8,
                        "neutral_count": 15,
                    }
                ]
            )
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/news/stats")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 33
    assert data["positive_count"] == 10
    assert data["negative_count"] == 8
    assert data["neutral_count"] == 15


def test_v2_news_refresh_returns_task_header() -> None:
    client = make_client()
    resp = client.post("/api/v2/news/refresh")
    assert resp.status_code == 202
    assert resp.headers["X-Task-Name"] == "tasks.news_tasks.fetch_all_sources"
    body = resp.json()
    assert body["data"]["status"] == "queued"
    assert body["data"]["task"] == "tasks.news_tasks.fetch_all_sources"
    assert body["data"]["task_id"]


def test_v2_news_sentiment_clause_contract() -> None:
    clause, params = news_v2._sentiment_clause("neutral")
    assert "BETWEEN" in clause
    assert params == {"sentiment_floor": -0.15, "sentiment_ceiling": 0.15}


def test_v2_news_feed_ignores_blank_query(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fail_fetch_and_store(*args, **kwargs):  # pragma: no cover - assertion guard
        raise AssertionError("fetch_and_store should not run when news table already has rows")

    monkeypatch.setattr(news_v2.aggregator, "fetch_and_store", _fail_fetch_and_store)
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "id": 4,
                        "title": "Macro update",
                        "source": "rss",
                        "published_at": datetime(2026, 3, 25, 12, 0, tzinfo=timezone.utc),
                        "symbols": ["SPY"],
                        "categories": ["macro"],
                        "markets": ["us"],
                        "sentiment": 0.05,
                        "importance": 2,
                        "llm_summary": "summary",
                        "llm_impact": "impact",
                        "url": "https://example.com/4",
                    }
                ]
            ),
            FakeResult(scalar=1),
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/news/feed", params={"query": "   ", "page_size": 1, "page": 2})
    assert resp.status_code == 200
    first_call_params = session.calls[0]["params"]
    assert "query" not in first_call_params
