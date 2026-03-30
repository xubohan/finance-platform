"""Contract tests for /api/v2/events routes."""

from __future__ import annotations

from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app.api.v2 import events as events_v2

from tests._v2_testutils import FakeResult, QueueAsyncSession, make_client


def test_v2_events_calendar_applies_filters() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "id": 10,
                        "title": "FOMC meeting",
                        "event_type": "fed_meeting",
                        "event_date": date(2026, 3, 25),
                        "event_time": datetime(2026, 3, 25, 18, 0, tzinfo=timezone.utc),
                        "symbols": ["SPY"],
                        "markets": ["us"],
                        "description": "desc",
                        "importance": 5,
                        "source": "calendar",
                        "source_url": "https://example.com/fomc",
                    }
                ]
            )
        ]
    )
    client = make_client(db_session=session)

    resp = client.get(
        "/api/v2/events/calendar",
        params={
            "start": "2026-03-01",
            "end": "2026-03-31",
            "market": "us",
            "event_type": "fed_meeting",
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["count"] == 1
    assert payload["meta"]["source"] == "persisted"
    assert isinstance(payload["meta"]["stale"], bool)
    assert payload["meta"]["as_of"] == "2026-03-25T18:00:00+00:00"
    assert payload["meta"]["read_only"] is True
    assert payload["meta"]["refresh_supported"] is True
    assert payload["meta"]["refresh_endpoint"] == "/api/v2/events/refresh"
    assert payload["data"][0]["event_type"] == "fed_meeting"

    params = session.calls[0]["params"]
    assert params["start_date"] == date(2026, 3, 1)
    assert params["end_date"] == date(2026, 3, 31)
    assert params["market"] == "us"
    assert params["event_type"] == "fed_meeting"


def test_v2_events_history_uppercases_symbol() -> None:
    session = QueueAsyncSession([FakeResult(rows=[])])
    client = make_client(db_session=session)

    resp = client.get("/api/v2/events/history", params={"symbol": "aapl", "limit": 5})
    assert resp.status_code == 200
    assert session.calls[0]["params"]["symbol"] == "AAPL"
    assert resp.json()["meta"]["count"] == 0
    assert resp.json()["meta"]["source"] == "persisted"
    assert isinstance(resp.json()["meta"]["stale"], bool)
    assert resp.json()["meta"]["as_of"] is None
    assert resp.json()["meta"]["refresh_supported"] is True
    assert resp.json()["meta"]["refresh_endpoint"] == "/api/v2/events/refresh"


def test_v2_events_detail_not_found() -> None:
    session = QueueAsyncSession([FakeResult(rows=[])])
    client = make_client(db_session=session)

    resp = client.get("/api/v2/events/404")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"]["code"] == "NOT_FOUND"


def test_v2_events_detail_returns_persisted_meta() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "id": 77,
                        "title": "CPI release",
                        "event_type": "macro",
                        "event_date": date(2026, 3, 26),
                        "event_time": datetime(2026, 3, 26, 12, 30, tzinfo=timezone.utc),
                        "symbols": ["SPY"],
                        "markets": ["us"],
                        "description": "desc",
                        "importance": 4,
                        "source": "calendar",
                        "source_url": "https://example.com/cpi",
                        "created_at": datetime(2026, 3, 26, 12, 31, tzinfo=timezone.utc),
                    }
                ]
            )
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/events/77")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"]["id"] == 77
    assert payload["meta"]["source"] == "persisted"
    assert isinstance(payload["meta"]["stale"], bool)
    assert payload["meta"]["as_of"] == "2026-03-26T12:30:00+00:00"
    assert payload["meta"]["read_only"] is True
    assert payload["meta"]["ingest_recommended"] is False
    assert payload["meta"]["refresh_supported"] is True
    assert payload["meta"]["refresh_endpoint"] == "/api/v2/events/refresh"
    assert payload["meta"]["backfill_endpoint"] == "/api/v2/events/77/impact/backfill"


def test_v2_events_impact_returns_event_and_symbol_impacts() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(rows=[{"id": 88, "title": "Fed decision", "event_date": date(2026, 2, 1)}]),
            FakeResult(
                rows=[
                    {
                        "symbol": "SPY",
                        "asset_type": "stock",
                        "t_minus_5d_ret": -1.2,
                        "t_minus_1d_ret": -0.1,
                        "t_plus_1d_ret": 0.8,
                        "t_plus_3d_ret": 1.5,
                        "t_plus_5d_ret": 2.1,
                        "t_plus_20d_ret": 4.3,
                        "vol_ratio_1d": 1.85,
                        "max_drawdown": -3.4,
                        "calculated_at": datetime(2026, 2, 2, tzinfo=timezone.utc),
                    }
                ]
            ),
        ]
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/events/88/impact")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["event_id"] == 88
    assert data["event_title"] == "Fed decision"
    assert len(data["impact_by_symbol"]) == 1
    assert data["impact_by_symbol"][0]["symbol"] == "SPY"
    meta = resp.json()["meta"]
    assert meta["source"] == "persisted"
    assert meta["as_of"] == "2026-02-02T00:00:00+00:00"
    assert isinstance(meta["stale"], bool)
    assert meta["read_only"] is True
    assert meta["refresh_supported"] is True
    assert meta["backfill_endpoint"] == "/api/v2/events/88/impact/backfill"


def test_v2_events_search_uses_date_range_filters() -> None:
    session = QueueAsyncSession([FakeResult(rows=[{"id": 1, "title": "rate hike", "event_date": date(2026, 3, 1)}])])
    client = make_client(db_session=session)

    resp = client.post(
        "/api/v2/events/search",
        json={
            "query": "加息",
            "event_type": "policy",
            "date_range": ["2026-01-01", "2026-03-01"],
        },
    )
    assert resp.status_code == 200
    assert resp.json()["meta"]["count"] == 1
    assert resp.json()["meta"]["source"] == "persisted"
    assert isinstance(resp.json()["meta"]["stale"], bool)
    assert resp.json()["meta"]["as_of"] == "2026-03-01T00:00:00+00:00"

    params = session.calls[0]["params"]
    assert params["query"] == "%加息%"
    assert params["event_type"] == "policy"
    assert params["start_date"] == date(2026, 1, 1)
    assert params["end_date"] == date(2026, 3, 1)


def test_v2_events_calendar_is_read_only_when_empty() -> None:
    session = QueueAsyncSession([FakeResult(rows=[])])
    client = make_client(db_session=session)

    resp = client.get("/api/v2/events/calendar")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"] == []
    assert payload["meta"]["source"] == "persisted"
    assert payload["meta"]["stale"] is True
    assert payload["meta"]["as_of"] is None
    assert payload["meta"]["read_only"] is True
    assert payload["meta"]["ingest_recommended"] is True
    assert payload["meta"]["refresh_supported"] is True
    assert payload["meta"]["refresh_endpoint"] == "/api/v2/events/refresh"
    assert session.commits == 0
    assert len(session.calls) == 1


def test_v2_events_calendar_skips_market_filter_for_all() -> None:
    session = QueueAsyncSession([FakeResult(rows=[])])
    client = make_client(db_session=session)

    resp = client.get("/api/v2/events/calendar", params={"market": "all"})
    assert resp.status_code == 200
    assert "market" not in session.calls[0]["params"]


def test_v2_events_refresh_queues_news_ingest_task(monkeypatch: pytest.MonkeyPatch) -> None:
    from tasks import news_tasks

    monkeypatch.setattr(news_tasks, "fetch_all_sources", SimpleNamespace(delay=lambda: SimpleNamespace(id="events-refresh-1")))
    client = make_client()

    resp = client.post("/api/v2/events/refresh")
    assert resp.status_code == 202
    payload = resp.json()
    assert payload["data"]["status"] == "queued"
    assert payload["data"]["task_id"] == "events-refresh-1"
    assert payload["meta"]["execution_mode"] == "celery"


def test_v2_events_task_reports_celery_status(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        events_v2,
        "AsyncResult",
        lambda task_id, app=None: SimpleNamespace(state="SUCCESS", result={"inserted": 12}),
    )
    client = make_client()

    resp = client.get("/api/v2/events/tasks/events-refresh-1")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"]["task_id"] == "events-refresh-1"
    assert payload["data"]["status"] == "completed"
    assert payload["data"]["result_payload"] == {"inserted": 12}
    assert payload["meta"]["task_name"] == "tasks.news_tasks.fetch_all_sources"


def test_v2_events_backfill_is_explicit_write_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_backfill(db, *, event_id, event_date, symbols):
        assert event_id == 51
        assert symbols == ["AAPL", "MSFT"]
        return 2

    monkeypatch.setattr(events_v2.impact_engine, "backfill_event_impacts", _fake_backfill)
    session = QueueAsyncSession(
        [
            FakeResult(rows=[{"id": 51, "event_date": date(2026, 3, 28), "symbols": ["AAPL", "MSFT"]}]),
        ]
    )
    client = make_client(db_session=session)
    resp = client.post("/api/v2/events/51/impact/backfill")
    assert resp.status_code == 202
    payload = resp.json()
    assert payload["data"]["status"] == "accepted"
    assert payload["data"]["inserted_records"] == 2
    assert payload["meta"]["execution_mode"] == "sync-write"
