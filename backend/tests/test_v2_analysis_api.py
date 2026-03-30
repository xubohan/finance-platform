"""Contract tests for /api/v2/analysis routes."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pandas as pd
import pytest

from app.api.v2 import analysis as analysis_v2
from app.services import analysis_controller as analysis_controller_service

from tests._v2_testutils import FakeResult, QueueAsyncSession, make_client


@pytest.fixture(autouse=True)
def _clear_analysis_task_cache() -> None:
    analysis_controller_service.LOCAL_TASK_RESULTS.clear()
    yield
    analysis_controller_service.LOCAL_TASK_RESULTS.clear()


def test_v2_analysis_sentiment_uppercases_context_symbols() -> None:
    client = make_client()
    resp = client.post(
        "/api/v2/analysis/sentiment",
        json={"text": "业绩超预期，利好。", "context_symbols": ["tsla", "spy"]},
    )
    assert resp.status_code == 200
    payload = resp.json()["data"]
    assert payload["context_symbols"] == ["TSLA", "SPY"]
    assert payload["sentiment_label"] in {"positive", "neutral", "negative"}


def test_v2_analysis_event_impact_requires_queue_when_delay_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analysis_v2, "run_event_impact_task", None)
    client = make_client(db_session=QueueAsyncSession([]))

    submit = client.post(
        "/api/v2/analysis/event-impact",
        json={
            "event_text": "美联储暂停加息并释放偏鸽信号",
            "event_type": "fed_meeting",
            "symbols": ["spy", "qqq"],
            "window_days": 20,
        },
    )

    assert submit.status_code == 503
    assert submit.json()["detail"]["error"]["code"] == "TASK_DISPATCH_UNAVAILABLE"


def test_v2_analysis_event_impact_queues_celery_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    session = QueueAsyncSession([])
    monkeypatch.setattr(
        analysis_v2,
        "run_event_impact_task",
        SimpleNamespace(delay=lambda payload: SimpleNamespace(id="analysis-task-1")),
    )
    client = make_client(db_session=session)

    submit = client.post(
        "/api/v2/analysis/event-impact",
        json={
            "event_text": "Fed keeps rates unchanged",
            "event_type": "macro",
            "symbols": ["SPY", "QQQ"],
            "window_days": 20,
        },
    )

    assert submit.status_code == 202
    payload = submit.json()
    assert payload["data"]["task_id"] == "analysis-task-1"
    assert payload["meta"]["execution_mode"] == "celery"

    status = client.get("/api/v2/analysis/tasks/analysis-task-1")
    assert status.status_code == 200
    assert status.json()["status"] == "pending"


def test_v2_analysis_task_pending_without_local_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analysis_controller_service, "AsyncResult", lambda task_id, app=None: SimpleNamespace(failed=lambda: False, successful=lambda: False, state="STARTED"))
    monkeypatch.setattr(analysis_controller_service, "celery_app", object())
    client = make_client()

    status = client.get("/api/v2/analysis/tasks/analysis-task-unknown")
    assert status.status_code == 200
    assert status.json()["status"] == "pending"


def test_v2_analysis_task_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analysis_v2.controller, "get_task_status", lambda task_id: {"status": "pending"})
    client = make_client()

    resp = client.get("/api/v2/analysis/tasks/pending-1")
    assert resp.status_code == 200
    assert resp.json() == {"status": "pending"}


def test_v2_analysis_task_failed_returns_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analysis_v2.controller, "get_task_status", lambda task_id: {"status": "failed", "task_id": task_id, "error": "boom"})
    client = make_client()

    resp = client.get("/api/v2/analysis/tasks/failed-1")
    assert resp.status_code == 200
    assert resp.json() == {"status": "failed", "task_id": "failed-1", "error": "boom"}


def test_v2_analysis_task_not_found() -> None:
    client = make_client()
    resp = client.get("/api/v2/analysis/tasks/not-exists")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"]["code"] == "NOT_FOUND"


def test_v2_analysis_correlation_requires_multiple_symbols() -> None:
    client = make_client(db_session=QueueAsyncSession([]))
    resp = client.get("/api/v2/analysis/correlation", params={"symbols": "AAPL", "period": "30d"})
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"]["code"] == "INVALID_SYMBOLS"


def test_v2_analysis_correlation_builds_matrix(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _mock_load_ohlcv_window(**kwargs):
        symbol = kwargs["symbol"]
        if symbol == "AAPL":
            return (
                pd.DataFrame(
                    {
                        "time": pd.to_datetime(["2026-03-01", "2026-03-02", "2026-03-03"], utc=True),
                        "close": [100.0, 101.0, 102.0],
                    }
                ),
                {"source": "local"},
            )
        return (
            pd.DataFrame(
                {
                    "time": pd.to_datetime(["2026-03-01", "2026-03-02", "2026-03-03"], utc=True),
                    "close": [200.0, 202.0, 204.0],
                }
            ),
            {"source": "local"},
        )

    monkeypatch.setattr(analysis_v2, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(analysis_v2, "load_ohlcv_window", _mock_load_ohlcv_window)
    client = make_client(db_session=QueueAsyncSession([]))

    resp = client.get("/api/v2/analysis/correlation", params={"symbols": "AAPL,MSFT", "period": "30d"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["rows"] == 3
    assert payload["data"]["symbols"] == ["AAPL", "MSFT"]
    assert len(payload["data"]["matrix"]) == 2


def test_v2_analysis_sector_heatmap_returns_grouped_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        analysis_v2,
        "fetch_stock_snapshot_with_meta",
        lambda market, limit, force_refresh=False, allow_stale=True: (
            [
                {"symbol": "AAPL", "change_pct": 1.2, "market_cap": 2_400_000_000_000},
                {"symbol": "MSFT", "change_pct": -0.6, "market_cap": 2_100_000_000_000},
                {"symbol": "SMALL1", "change_pct": 3.1, "market_cap": 2_000_000_000},
            ],
            {"source": "cache", "stale": False, "as_of": "2026-03-25T10:00:00+00:00", "cache_age_sec": 5},
        ),
    )
    client = make_client()
    resp = client.get("/api/v2/analysis/sector-heatmap", params={"market": "us"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["market"] == "us"
    assert payload["meta"]["count"] >= 1
    assert payload["meta"]["symbols_considered"] == 3
    assert payload["meta"]["grouping"] == "market_cap_bucket"
    assert any(row["sector"] == "Mega Cap" for row in payload["data"])


def test_v2_analysis_cn_flow_heatmap_returns_rows() -> None:
    session = QueueAsyncSession(
        [
            FakeResult(
                rows=[
                    {
                        "symbol": "600000.SH",
                        "trade_date": datetime(2026, 3, 25, tzinfo=timezone.utc),
                        "main_net": 1_000_000,
                        "super_large_net": 100_000,
                        "large_net": 50_000,
                        "medium_net": -10_000,
                        "small_net": -20_000,
                    }
                ]
            )
        ]
    )
    client = make_client(db_session=session)
    resp = client.get("/api/v2/analysis/cn-flow-heatmap")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["count"] == 1
    assert payload["meta"]["source"] == "persisted"
    assert payload["meta"]["entity_type"] == "symbol"
    assert payload["data"][0]["symbol"] == "600000.SH"


def test_v2_analysis_cn_flow_heatmap_falls_back_to_live_sector_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    session = QueueAsyncSession([FakeResult(rows=[])])
    monkeypatch.setattr(
        analysis_v2,
        "fetch_sector_flow_snapshot",
        lambda limit=30: [
            {
                "symbol": "通信设备",
                "display_name": "通信设备",
                "entity_type": "sector",
                "leader_symbol": "亨通光电",
                "trade_date": "2026-03-30",
                "as_of": "2026-03-28T10:15:00+08:00",
                "change_pct": 1.2,
                "main_net": 3269622016.0,
                "super_large_net": 3236981760.0,
                "large_net": 32640256.0,
                "medium_net": -351217408.0,
                "small_net": -2893428736.0,
            }
        ],
    )
    client = make_client(db_session=session)

    resp = client.get("/api/v2/analysis/cn-flow-heatmap")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["meta"]["count"] == 1
    assert payload["meta"]["source"] == "eastmoney_sector_flow"
    assert payload["meta"]["entity_type"] == "sector"
    assert payload["meta"]["as_of"] == "2026-03-28T10:15:00+08:00"
    assert payload["meta"]["stale"] is True
    assert payload["data"][0]["display_name"] == "通信设备"
    assert payload["data"][0]["leader_symbol"] == "亨通光电"


def test_cn_flow_trade_date_stale_helper_uses_trade_day(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FrozenDateTime:
        @staticmethod
        def now(tz=None):
            return datetime(2026, 3, 30, 12, 0, tzinfo=tz)

    monkeypatch.setattr(analysis_v2, "datetime", _FrozenDateTime)

    assert analysis_v2._cn_flow_trade_date_is_stale("2026-03-29") is True
    assert analysis_v2._cn_flow_trade_date_is_stale("2026-03-30") is False
