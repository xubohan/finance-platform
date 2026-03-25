"""Contract tests for /api/v2/analysis routes."""

from __future__ import annotations

from datetime import datetime, timezone

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


def test_v2_analysis_event_impact_async_task_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _mock_run_event_impact(*, db, payload):
        assert payload.event_type == "fed_meeting"
        assert payload.symbols == ["spy", "qqq"]
        return {
            "data": {
                "sentiment_score": 0.4,
                "sentiment_label": "positive",
                "llm_analysis": {
                    "summary": "mock-summary",
                    "key_factors": ["policy easing"],
                    "risk_factors": [],
                    "impact_assessment": "mock-impact",
                },
                "historical_context": {
                    "event_type": "fed_meeting",
                    "similar_events_found": 7,
                },
                "symbol_predictions": [
                    {
                        "symbol": "SPY",
                        "historical_avg_return_5d": 1.8,
                        "predicted_direction": "up",
                        "confidence": 0.72,
                        "basis": "mock-basis",
                        "return_distribution": {"p50": 1.8},
                    }
                ],
            },
            "meta": {"task_id": "", "model_used": "heuristic-v1", "tokens_used": 0, "processing_ms": 0},
        }

    session = QueueAsyncSession([])
    monkeypatch.setattr(analysis_v2.controller, "run_event_impact", _mock_run_event_impact)
    client = make_client(db_session=session)

    submit = client.post(
        "/api/v2/analysis/event-impact",
        json={
            "event_text": "美联储暂停加息并释放偏鸽信号",
            "event_type": "fed_meeting",
            "symbols": ["spy", "qqq"],
            "window_days": 20,
        },
    )
    assert submit.status_code == 200
    task_id = submit.json()["data"]["task_id"]
    assert task_id

    task_resp = client.get(f"/api/v2/analysis/tasks/{task_id}")
    assert task_resp.status_code == 200
    task_payload = task_resp.json()
    assert task_payload["status"] == "completed"
    result = task_payload["result"]
    assert result["meta"]["task_id"] == task_id
    assert result["data"]["historical_context"]["similar_events_found"] == 7
    assert result["data"]["symbol_predictions"][0]["symbol"] == "SPY"


def test_v2_analysis_task_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analysis_v2.controller, "get_task_status", lambda task_id: {"status": "pending"})
    client = make_client()

    resp = client.get("/api/v2/analysis/tasks/pending-1")
    assert resp.status_code == 200
    assert resp.json() == {"status": "pending"}


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
    assert payload["data"][0]["symbol"] == "600000.SH"
