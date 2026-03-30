"""Contract tests for /api/v2/backtest routes."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from tests._v2_testutils import FakeResult, QueueAsyncSession, make_client


def _run_payload() -> dict[str, object]:
    return {
        "symbol": "AAPL",
        "asset_type": "stock",
        "strategy_name": "ma_cross",
        "parameters": {"fast": 5, "slow": 20},
        "start_date": "2024-01-01",
        "end_date": "2024-12-31",
        "initial_capital": 1_000_000,
    }


def test_v2_backtest_run_async_dispatches_celery(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import backtest as backtest_v2

    backtest_v2._queued_backtest_tasks.clear()
    monkeypatch.setattr(backtest_v2.celery_app, "send_task", lambda name, args=None: SimpleNamespace(id="bt-queued-1"))
    client = make_client()

    resp = client.post("/api/v2/backtest/run?async_mode=true", json=_run_payload())

    assert resp.status_code == 202
    payload = resp.json()
    assert payload["data"] == {"status": "queued", "task_id": "bt-queued-1", "task_kind": "run"}
    assert payload["meta"]["execution_mode"] == "celery"
    assert "accepted_at" in payload["meta"]
    assert payload["meta"]["task_id"] == "bt-queued-1"
    assert backtest_v2._queued_backtest_tasks["bt-queued-1"]["task_name"] == "tasks.backtest_tasks.run_single_backtest"


def test_v2_backtest_task_returns_queued_for_registered_celery_task(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import backtest as backtest_v2

    backtest_v2._queued_backtest_tasks.clear()
    backtest_v2._queued_backtest_tasks["bt-queued-2"] = {
        "task_name": "tasks.backtest_tasks.run_compare_backtest",
        "accepted_at": "2026-03-28T00:00:00+00:00",
    }
    monkeypatch.setattr(
        backtest_v2,
        "AsyncResult",
        lambda task_id, app=None: SimpleNamespace(state="PENDING", failed=lambda: False, successful=lambda: False, result=None),
    )
    client = make_client(db_session=QueueAsyncSession([FakeResult(rows=[])]))

    resp = client.get("/api/v2/backtest/tasks/bt-queued-2")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"] == {"task_id": "bt-queued-2", "status": "queued", "task_kind": "compare"}
    assert payload["meta"]["execution_mode"] == "celery"
    assert payload["meta"]["task_name"] == "tasks.backtest_tasks.run_compare_backtest"


def test_v2_backtest_task_returns_running_for_started_celery_task(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import backtest as backtest_v2

    backtest_v2._queued_backtest_tasks.clear()
    backtest_v2._queued_backtest_tasks["bt-running-1"] = {
        "task_name": "tasks.backtest_tasks.run_lab_backtest",
        "accepted_at": "2026-03-28T00:00:00+00:00",
    }
    monkeypatch.setattr(
        backtest_v2,
        "AsyncResult",
        lambda task_id, app=None: SimpleNamespace(state="STARTED", failed=lambda: False, successful=lambda: False, result=None),
    )
    client = make_client(db_session=QueueAsyncSession([FakeResult(rows=[])]))

    resp = client.get("/api/v2/backtest/tasks/bt-running-1")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"] == {"task_id": "bt-running-1", "status": "running", "task_kind": "lab"}
    assert payload["meta"]["execution_mode"] == "celery"
    assert payload["meta"]["task_name"] == "tasks.backtest_tasks.run_lab_backtest"


def test_v2_backtest_task_returns_404_for_unknown_pending_id(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import backtest as backtest_v2

    backtest_v2._queued_backtest_tasks.clear()
    monkeypatch.setattr(
        backtest_v2,
        "AsyncResult",
        lambda task_id, app=None: SimpleNamespace(state="PENDING", failed=lambda: False, successful=lambda: False, result=None),
    )
    client = make_client(db_session=QueueAsyncSession([FakeResult(rows=[])]))

    resp = client.get("/api/v2/backtest/tasks/bt-unknown")

    assert resp.status_code == 404
    assert resp.json()["detail"]["error"]["code"] == "NOT_FOUND"


def test_v2_backtest_task_returns_completed_celery_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import backtest as backtest_v2

    backtest_v2._queued_backtest_tasks.clear()
    backtest_v2._queued_backtest_tasks["bt-success"] = {
        "task_name": "tasks.backtest_tasks.run_single_backtest",
        "accepted_at": "2026-03-28T00:00:00+00:00",
    }
    monkeypatch.setattr(
        backtest_v2,
        "AsyncResult",
        lambda task_id, app=None: SimpleNamespace(
            state="SUCCESS",
            failed=lambda: False,
            successful=lambda: True,
            result={"data": {"status": "done"}},
        ),
    )
    client = make_client(db_session=QueueAsyncSession([FakeResult(rows=[])]))

    resp = client.get("/api/v2/backtest/tasks/bt-success")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"]["task_id"] == "bt-success"
    assert payload["data"]["status"] == "completed"
    assert payload["data"]["task_kind"] == "run"
    assert payload["data"]["result_payload"] == {"data": {"status": "done"}}
    assert payload["meta"]["execution_mode"] == "celery"
