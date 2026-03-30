"""Runtime-focused tests for Celery/task helpers and controller degradation semantics."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import sys
from types import SimpleNamespace
from types import ModuleType

import pandas as pd

from app.config import Settings
from app.schemas.analysis import EventImpactRequest
from app.services.analysis_controller import AnalysisController
from app.services.llm_service import LLMServiceError
from app.services.news_aggregator import NewsAggregator


class _FakeCeleryApp:
    def task(self, *args, **kwargs):
        def _decorator(fn):
            return fn

        return _decorator


if "tasks.celery_app" not in sys.modules:
    fake_module = ModuleType("tasks.celery_app")
    fake_module.celery_app = _FakeCeleryApp()
    sys.modules["tasks.celery_app"] = fake_module

from tasks import analysis_tasks, data_tasks, news_tasks, ohlcv_tasks


class _FakeAsyncSessionContext:
    def __init__(self, session) -> None:
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc, tb):
        return False


def test_run_event_impact_task_validates_payload(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeController:
        def __init__(self, runtime_settings) -> None:
            self.runtime_settings = runtime_settings

        async def run_event_impact(self, *, db, payload):
            captured["payload"] = payload
            return {"status": "completed", "payload_type": type(payload).__name__}

    fake_session = object()
    monkeypatch.setattr(analysis_tasks, "get_task_db_session", lambda: _FakeAsyncSessionContext(fake_session))
    monkeypatch.setattr(analysis_tasks, "AnalysisController", FakeController)

    result = analysis_tasks.run_event_impact(
        {
          "event_text": "Fed keeps rates unchanged",
          "event_type": "macro",
          "symbols": ["SPY", "QQQ"],
          "window_days": 20,
        }
    )

    assert result["status"] == "completed"
    assert result["payload_type"] == "EventImpactRequest"
    assert isinstance(captured["payload"], EventImpactRequest)


def test_sync_cn_watchlist_pulls_upstream_data(monkeypatch) -> None:
    class FakeScalarResult:
        def scalars(self):
            return self

        def all(self):
            return ["600519.SH", "000001.SZ"]

    class FakeSession:
        async def execute(self, statement, params=None):
            return FakeScalarResult()

    synced_symbols: list[str] = []

    async def fake_sync_ohlcv_from_upstream(*, db, symbol: str, asset_type: str, start_date: str, end_date: str, interval: str):
        synced_symbols.append(symbol)
        return pd.DataFrame(
            [
                {"time": "2026-03-20T00:00:00Z", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 100},
            ]
        ), {"source": "live"}

    monkeypatch.setattr(ohlcv_tasks, "get_task_db_session", lambda: _FakeAsyncSessionContext(FakeSession()))
    monkeypatch.setattr(ohlcv_tasks, "detect_provider", lambda symbol: ("stock", "akshare"))
    monkeypatch.setattr(ohlcv_tasks, "sync_ohlcv_from_upstream", fake_sync_ohlcv_from_upstream)

    result = ohlcv_tasks.sync_cn_watchlist()

    assert result["status"] == "completed"
    assert result["synced_symbols"] == 2
    assert result["synced_rows"] == 2
    assert result["failed_symbols"] == []
    assert synced_symbols == ["600519.SH", "000001.SZ"]


def test_fetch_all_sources_uses_task_scoped_session(monkeypatch) -> None:
    class FakeAggregator:
        def __init__(self, runtime_settings) -> None:
            self.runtime_settings = runtime_settings

        async def fetch_and_store(self, session, market: str, limit_per_source: int):
            assert market == "all"
            assert limit_per_source == 10
            assert session == "task-session"
            return {"count": 3, "inserted": 2, "updated": 1}

    monkeypatch.setattr(news_tasks, "get_task_db_session", lambda: _FakeAsyncSessionContext("task-session"))
    monkeypatch.setattr(news_tasks, "NewsAggregator", FakeAggregator)

    result = news_tasks.fetch_all_sources()

    assert result["status"] == "completed"
    assert result["fetched_items"] == 3
    assert result["inserted"] == 2
    assert result["updated"] == 1


def test_sync_symbol_upserts_rows_with_task_scoped_session(monkeypatch) -> None:
    class FakeSession:
        def __init__(self) -> None:
            self.executed: list[tuple[str, list[dict[str, object]]]] = []
            self.commits = 0

        async def execute(self, statement, params=None):
            self.executed.append((str(statement), params))
            return None

        async def commit(self) -> None:
            self.commits += 1

    fake_session = FakeSession()

    monkeypatch.setattr(data_tasks, "get_task_db_session", lambda: _FakeAsyncSessionContext(fake_session))
    monkeypatch.setattr(data_tasks, "detect_provider", lambda symbol: ("stock", "yfinance"))
    monkeypatch.setattr(
        data_tasks,
        "fetch_ohlcv",
        lambda symbol, start_date, end_date, interval: pd.DataFrame(
            [
                {
                    "time": pd.Timestamp("2026-03-24T00:00:00Z"),
                    "open": 100.0,
                    "high": 101.0,
                    "low": 99.5,
                    "close": 100.5,
                    "volume": 1_000_000.0,
                }
            ]
        ),
    )

    result = data_tasks.sync_symbol("aapl", start_date="2026-03-24", end_date="2026-03-24")

    assert result == {"symbol": "AAPL", "inserted": 1, "asset_type": "stock"}
    assert fake_session.commits == 1
    assert len(fake_session.executed) == 1
    stmt, params = fake_session.executed[0]
    assert "INSERT INTO ohlcv_daily" in stmt
    assert params[0]["symbol"] == "AAPL"


def test_news_aggregator_rolls_back_after_failed_update(monkeypatch) -> None:
    class FakeResult:
        def mappings(self):
            return self

        def all(self):
            return [{"id": 1, "title": "Sample", "content": "text", "symbols": ["SPY"]}]

    class FakeSession:
        def __init__(self) -> None:
            self.calls = 0
            self.rollbacks = 0
            self.commits = 0

        async def execute(self, statement, params=None):
            self.calls += 1
            if self.calls == 1:
                return FakeResult()
            raise RuntimeError("db write failed")

        async def rollback(self) -> None:
            self.rollbacks += 1

        async def commit(self) -> None:
            self.commits += 1

    aggregator = NewsAggregator(Settings(enable_llm_analysis=False, initialize_runtime_schema=False))
    monkeypatch.setattr(aggregator, "llm", SimpleNamespace(enabled=False))
    session = FakeSession()

    result = asyncio.run(aggregator.process_pending_llm(session, batch_size=1))

    assert result == {"processed": 0, "failed": 1}
    assert session.rollbacks == 1
    assert session.commits == 1


def test_news_aggregator_persist_normalizes_datetime_fields() -> None:
    class FakeInsertResult:
        def scalar_one(self) -> bool:
            return True

    class FakeSession:
        def __init__(self) -> None:
            self.statements: list[str] = []
            self.params: list[dict[str, object]] = []
            self.commits = 0

        async def execute(self, statement, params=None):
            self.statements.append(str(statement))
            if params is not None:
                self.params.append(params)
            return FakeInsertResult()

        async def commit(self) -> None:
            self.commits += 1

    aggregator = NewsAggregator(Settings(enable_llm_analysis=False, initialize_runtime_schema=False))
    session = FakeSession()

    result = asyncio.run(
        aggregator.persist(
            session,
            [
                {
                    "source": "rss",
                    "source_id": "item-1",
                    "title": "Normalization check",
                    "content": "Body",
                    "url": "https://example.com/news",
                    "published_at": "2026-03-25T12:48:39Z",
                    "symbols": ["SPY"],
                    "categories": ["macro"],
                    "markets": ["us"],
                    "sentiment": 0.1,
                    "importance": 4,
                    "llm_summary": None,
                    "llm_impact": None,
                    "llm_key_factors": [],
                    "processed": False,
                    "created_at": "2026-03-25T12:49:01Z",
                }
            ],
        )
    )

    assert result == {"inserted": 1, "updated": 0}
    assert session.commits == 1
    assert "ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL" in session.statements[0]
    assert len(session.params) == 2
    assert session.params[0]["published_at"] == datetime(2026, 3, 25, 12, 48, 39, tzinfo=timezone.utc)
    assert session.params[0]["created_at"] == datetime(2026, 3, 25, 12, 49, 1, tzinfo=timezone.utc)
    assert session.params[1]["event_time"] == datetime(2026, 3, 25, 12, 48, 39, tzinfo=timezone.utc)


def test_analysis_controller_marks_degraded_when_llm_fails(monkeypatch) -> None:
    controller = AnalysisController(Settings(enable_llm_analysis=True, initialize_runtime_schema=False))

    async def fake_historical_context(db, event_type: str, symbols: list[str]):
        return {"similar_events_found": 2, "average_return_5d": 1.4, "win_rate_5d": 62.5}, [
            {"symbol": "SPY", "historical_avg_return_5d": 1.4, "historical_avg_return_20d": 3.1},
        ]

    async def fake_analyze_event_impact(**kwargs):
        raise LLMServiceError("provider timeout")

    monkeypatch.setattr(controller.event_engine, "historical_context", fake_historical_context)
    monkeypatch.setattr(
        controller,
        "llm",
        SimpleNamespace(
            enabled=True,
            analyze_event_impact=fake_analyze_event_impact,
        ),
    )

    result = asyncio.run(
        controller.run_event_impact(
            db=SimpleNamespace(),
            payload=EventImpactRequest(
                event_text="Fed signals slower cuts",
                event_type="macro",
                symbols=["SPY"],
                window_days=20,
            ),
        )
    )

    assert result["meta"]["degraded"] is True
    assert "llm_error" in result["meta"]["degraded_reason"]
    assert result["meta"]["model_used"] == "heuristic-v1"


def test_analysis_controller_sanitizes_heuristic_summary(monkeypatch) -> None:
    controller = AnalysisController(Settings(enable_llm_analysis=False, initialize_runtime_schema=False))

    async def fake_historical_context(db, event_type: str, symbols: list[str]):
        return {"similar_events_found": 1, "sample_description": "样本 1 条"}, [
            {"symbol": "SPY", "historical_avg_return_5d": 1.2, "historical_avg_return_20d": 2.6},
        ]

    monkeypatch.setattr(controller.event_engine, "historical_context", fake_historical_context)

    result = asyncio.run(
        controller.run_event_impact(
            db=SimpleNamespace(),
            payload=EventImpactRequest(
                event_text="<!-- SC_OFF --><div class='md'><p>Saw this on Blossom &amp; thought this matters.</p><p>https://example.com/path</p></div>",
                event_type="macro",
                symbols=["SPY"],
                window_days=20,
            ),
        )
    )

    summary = result["data"]["llm_analysis"]["summary"]
    assert "Saw this on Blossom" in summary
    assert "<div" not in summary
    assert "https://example.com" not in summary
