"""Contract tests for /api/v2/news routes."""

from __future__ import annotations

from datetime import datetime, timezone
import sys
from types import SimpleNamespace

import pytest

from app.api.v2 import news as news_v2

from tests._v2_testutils import FakeResult, QueueAsyncSession, make_client


def test_v2_news_feed_filters_and_meta_distribution() -> None:
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
            FakeResult(rows=[{"positive": 8, "neutral": 21, "negative": 13}]),
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
        "positive": 8,
        "neutral": 21,
        "negative": 13,
    }
    assert payload["meta"]["source"] == "persisted"
    assert isinstance(payload["meta"]["stale"], bool)
    assert payload["meta"]["as_of"] == "2026-03-25T10:00:00+00:00"
    assert payload["meta"]["read_only"] is True
    assert payload["meta"]["refresh_endpoint"] == "/api/v2/news/refresh"
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
    assert payload["meta"]["source"] == "persisted"
    assert isinstance(payload["meta"]["stale"], bool)
    assert payload["meta"]["as_of"] == "2026-03-25T11:00:00+00:00"
    assert "generated_at" in payload["meta"]


def test_v2_news_stats_returns_today_and_week_distribution() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "week_total": 33,
                        "week_positive_count": 10,
                        "week_negative_count": 8,
                        "week_neutral_count": 15,
                        "today_total": 6,
                        "today_positive_count": 3,
                        "today_negative_count": 1,
                        "today_neutral_count": 2,
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
    assert data["week"]["total"] == 33
    assert data["today"] == {
        "total": 6,
        "positive_count": 3,
        "negative_count": 1,
        "neutral_count": 2,
    }
    meta = resp.json()["meta"]
    assert meta["source"] == "persisted"
    assert meta["stale"] is True
    assert meta["as_of"] is None
    assert meta["refresh_supported"] is True
    assert meta["refresh_endpoint"] == "/api/v2/news/refresh"


def test_v2_news_refresh_requires_queue_when_delay_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(
        sys.modules,
        "tasks.news_tasks",
        SimpleNamespace(fetch_all_sources=lambda: {"status": "completed", "fetched_items": 3}),
    )
    client = make_client()
    resp = client.post("/api/v2/news/refresh")
    assert resp.status_code == 503
    assert resp.json()["detail"]["error"]["code"] == "TASK_DISPATCH_UNAVAILABLE"


def test_v2_news_refresh_returns_queued_when_delay_available(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakeTask:
        def delay(self):
            return SimpleNamespace(id="news-task-1")

    monkeypatch.setitem(__import__("sys").modules, "tasks.news_tasks", SimpleNamespace(fetch_all_sources=_FakeTask()))
    client = make_client()

    resp = client.post("/api/v2/news/refresh")
    assert resp.status_code == 202
    body = resp.json()
    assert body["data"]["status"] == "queued"
    assert body["data"]["task_id"] == "news-task-1"
    assert body["meta"]["execution_mode"] == "celery"


def test_v2_news_task_reports_completed_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        news_v2,
        "AsyncResult",
        lambda task_id, app=None: SimpleNamespace(state="SUCCESS", result={"data": {"fetched_items": 3}}),
    )
    client = make_client()

    resp = client.get("/api/v2/news/tasks/news-task-1")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"]["task_id"] == "news-task-1"
    assert payload["data"]["status"] == "completed"
    assert payload["data"]["result_payload"] == {"data": {"fetched_items": 3}}
    assert payload["meta"]["task_name"] == "tasks.news_tasks.fetch_all_sources"


def test_v2_news_task_exposes_degraded_partial_result_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        news_v2,
        "AsyncResult",
        lambda task_id, app=None: SimpleNamespace(
            state="SUCCESS",
            result={
                "status": "completed",
                "fetched_items": 8,
                "degraded": True,
                "partial": True,
                "source_errors": [
                    {
                        "source_id": "eastmoney_notice_sz",
                        "stage": "fetch",
                        "error": "eastmoney timeout",
                    }
                ],
            },
        ),
    )
    client = make_client()

    resp = client.get("/api/v2/news/tasks/news-task-partial")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"]["status"] == "completed"
    result_payload = payload["data"]["result_payload"]
    assert result_payload["degraded"] is True
    assert result_payload["partial"] is True
    assert result_payload["source_errors"][0]["source_id"] == "eastmoney_notice_sz"
    assert result_payload["source_errors"][0]["stage"] == "fetch"


def test_v2_news_sentiment_clause_contract() -> None:
    clause, params = news_v2._sentiment_clause("neutral")
    assert "BETWEEN" in clause
    assert params == {"sentiment_floor": -0.15, "sentiment_ceiling": 0.15}


def test_v2_news_feed_ignores_blank_query() -> None:
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
            FakeResult(rows=[{"positive": 0, "neutral": 1, "negative": 0}]),
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/news/feed", params={"query": "   ", "page_size": 1, "page": 2})
    assert resp.status_code == 200
    first_call_params = session.calls[0]["params"]
    assert "query" not in first_call_params


def test_v2_news_feed_supports_multi_market_and_sentiment_range() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "id": 8,
                        "title": "Cross-market update",
                        "source": "rss",
                        "published_at": datetime(2026, 3, 25, 13, 0, tzinfo=timezone.utc),
                        "symbols": ["AAPL", "0700.HK"],
                        "categories": ["macro", "policy"],
                        "markets": ["us", "cn"],
                        "sentiment": 0.12,
                        "importance": 4,
                        "llm_summary": "summary",
                        "llm_impact": "impact",
                        "url": "https://example.com/8",
                    }
                ]
            ),
            FakeResult(scalar=1),
            FakeResult(rows=[{"positive": 0, "neutral": 1, "negative": 0}]),
        ]
    )
    client = make_client(db_session=session)

    resp = client.get(
        "/api/v2/news/feed",
        params={
            "markets": "us,cn",
            "category": "macro,policy",
            "sentiment_min": -0.25,
            "sentiment_max": 0.35,
            "page_size": 5,
        },
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["markets"] == ["us", "cn"]
    assert payload["meta"]["source"] == "persisted"
    assert isinstance(payload["meta"]["stale"], bool)
    assert payload["meta"]["as_of"] == "2026-03-25T13:00:00+00:00"
    data_call_params = session.calls[0]["params"]
    assert data_call_params["markets"] == ["us", "cn"]
    assert data_call_params["categories"] == ["macro", "policy"]
    assert data_call_params["sentiment_min_value"] == -0.25
    assert data_call_params["sentiment_max_value"] == 0.35


def test_v2_news_feed_rejects_invalid_sentiment_range() -> None:
    client = make_client(db_session=QueueAsyncSession([]))
    resp = client.get("/api/v2/news/feed", params={"sentiment_min": 0.4, "sentiment_max": -0.4})

    assert resp.status_code == 400
    assert resp.json()["detail"]["error"]["code"] == "INVALID_NEWS_FILTERS"


def test_v2_symbol_news_feed_forwards_full_filter_contract() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "id": 9,
                        "title": "AAPL earnings watch",
                        "source": "rss",
                        "published_at": datetime(2026, 3, 25, 14, 0, tzinfo=timezone.utc),
                        "symbols": ["AAPL", "MSFT"],
                        "categories": ["earnings"],
                        "markets": ["us"],
                        "sentiment": 0.45,
                        "importance": 5,
                        "llm_summary": "summary",
                        "llm_impact": "impact",
                        "url": "https://example.com/9",
                    }
                ]
            ),
            FakeResult(scalar=1),
            FakeResult(rows=[{"positive": 1, "neutral": 0, "negative": 0}]),
        ]
    )
    client = make_client(db_session=session)

    resp = client.get(
        "/api/v2/news/AAPL/feed",
        params={
            "query": "earnings",
            "symbols": "msft",
            "category": "earnings",
            "sentiment": "positive",
            "sentiment_min": 0.2,
            "sentiment_max": 0.8,
            "importance": 4,
            "start": "2026-03-20",
            "end": "2026-03-26",
            "page": 2,
            "page_size": 5,
        },
    )

    assert resp.status_code == 200
    first_call_params = session.calls[0]["params"]
    assert first_call_params["query"] == "%earnings%"
    assert first_call_params["symbols"] == ["AAPL", "MSFT"]
    assert first_call_params["categories"] == ["earnings"]
    assert first_call_params["importance"] == 4
    assert first_call_params["sentiment_threshold"] == 0.15
    assert first_call_params["sentiment_min_value"] == 0.2
    assert first_call_params["sentiment_max_value"] == 0.8
    assert first_call_params["start_date"] == datetime(2026, 3, 20, 0, 0, tzinfo=timezone.utc)
    assert first_call_params["end_date"] == datetime(2026, 3, 27, 0, 0, tzinfo=timezone.utc)
    assert first_call_params["offset"] == 5
    assert "published_at < :end_date" in session.calls[0]["sql"]


def test_v2_news_feed_is_read_only_when_table_empty() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(rows=[]),
            FakeResult(scalar=0),
            FakeResult(rows=[{"positive": 0, "neutral": 0, "negative": 0}]),
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/news/feed", params={"page": 1, "page_size": 5})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"] == []
    assert payload["meta"]["source"] == "persisted"
    assert payload["meta"]["stale"] is True
    assert payload["meta"]["as_of"] is None
    assert payload["meta"]["read_only"] is True
    assert payload["meta"]["ingest_recommended"] is True
    assert payload["meta"]["refresh_endpoint"] == "/api/v2/news/refresh"
    assert session.commits == 0
    assert len(session.calls) == 3


def test_v2_news_feed_converts_date_filters_to_utc_bounds() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "id": 21,
                        "title": "Date-filtered row",
                        "source": "rss",
                        "published_at": datetime(2026, 3, 26, 11, 0, tzinfo=timezone.utc),
                        "symbols": ["BTC"],
                        "categories": ["macro"],
                        "markets": ["crypto"],
                        "sentiment": 0.0,
                        "importance": 2,
                        "llm_summary": "summary",
                        "llm_impact": "impact",
                        "url": "https://example.com/21",
                    }
                ]
            ),
            FakeResult(scalar=1),
            FakeResult(rows=[{"positive": 0, "neutral": 1, "negative": 0}]),
        ]
    )
    client = make_client(db_session=session)

    resp = client.get(
        "/api/v2/news/feed",
        params={
            "start": "2026-03-19",
            "end": "2026-03-26",
            "importance": 2,
            "sentiment_min": -0.4,
            "sentiment_max": 0.6,
            "page_size": 24,
        },
    )

    assert resp.status_code == 200
    first_call = session.calls[0]
    assert first_call["params"]["start_date"] == datetime(2026, 3, 19, 0, 0, tzinfo=timezone.utc)
    assert first_call["params"]["end_date"] == datetime(2026, 3, 27, 0, 0, tzinfo=timezone.utc)
    assert "published_at >= :start_date" in first_call["sql"]
    assert "published_at < :end_date" in first_call["sql"]
