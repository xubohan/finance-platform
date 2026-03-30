"""V2 backtest routes."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from celery.result import AsyncResult
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import backtest as backtest_v1
from app.database import get_db
from tasks.celery_app import celery_app

router = APIRouter()
_queued_backtest_tasks: dict[str, dict[str, str]] = {}
_TASK_KIND_BY_NAME = {
    "tasks.backtest_tasks.run_single_backtest": "run",
    "tasks.backtest_tasks.run_compare_backtest": "compare",
    "tasks.backtest_tasks.run_lab_backtest": "lab",
}


@router.get("/strategies")
async def list_backtest_strategies() -> dict[str, Any]:
    return await backtest_v1.list_backtest_strategies()


def _with_execution_meta(payload: dict[str, Any], *, execution_mode: str) -> dict[str, Any]:
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    payload["meta"] = {
        **meta,
        "execution_mode": execution_mode,
    }
    return payload


def _task_kind(task_name: str | None) -> str | None:
    if not task_name:
        return None
    return _TASK_KIND_BY_NAME.get(task_name)


def _normalize_task_status(status: str | None) -> str:
    normalized = str(status or "").strip().lower()
    if normalized in {"queued", "pending", "received"}:
        return "queued"
    if normalized in {"started", "running", "retry", "in_progress", "progress"}:
        return "running"
    if normalized in {"success", "done", "completed", "complete"}:
        return "completed"
    if normalized in {"failed", "error", "cancelled", "canceled"}:
        return "failed"
    return normalized or "queued"


def _task_response(
    task_id: str,
    *,
    status: str,
    task_name: str | None,
    accepted_at: str | None,
    result_payload: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "data": {
            "task_id": task_id,
            "status": status,
            "task_kind": _task_kind(task_name),
        },
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "execution_mode": "celery",
            "accepted_at": accepted_at,
            "task_name": task_name,
        },
    }
    if result_payload is not None:
        payload["data"]["result_payload"] = result_payload
    if error is not None:
        payload["data"]["error"] = error
    return payload


def _build_persisted_run_payload(row: dict[str, Any]) -> dict[str, Any] | None:
    if row.get("result_created_at") is None:
        return None
    return {
        "data": {
            "equity_curve": row.get("equity_curve") or [],
            "trades": row.get("trade_records") or [],
            "metrics": {
                "total_return": row.get("total_return"),
                "annual_return": row.get("annual_return"),
                "sharpe_ratio": row.get("sharpe_ratio"),
                "max_drawdown": row.get("max_drawdown"),
                "win_rate": row.get("win_rate"),
                "trade_count": row.get("trade_count"),
            },
        },
        "meta": {
            "execution_mode": "persisted",
            "source": "persisted",
            "storage_source": "persisted",
            "as_of": row.get("result_created_at"),
        },
    }


def _dispatch_task(task_name: str, payload: dict[str, Any]) -> tuple[str, str]:
    try:
        task = celery_app.send_task(task_name, args=[payload])
    except Exception as exc:  # pragma: no cover - broker/runtime dependent
        raise HTTPException(
            status_code=503,
            detail={"error": {"code": "TASK_DISPATCH_FAILED", "message": f"Failed to dispatch {task_name}: {exc}"}},
        ) from exc
    task_id = str(task.id)
    accepted_at = datetime.now(timezone.utc).isoformat()
    _queued_backtest_tasks[task_id] = {
        "task_name": task_name,
        "task_kind": _task_kind(task_name) or "",
        "accepted_at": accepted_at,
    }
    return task_id, accepted_at


def _read_celery_task(task_id: str) -> dict[str, Any] | None:
    celery_task = AsyncResult(task_id, app=celery_app)
    state = str(celery_task.state).lower()
    queued_meta = _queued_backtest_tasks.get(task_id)
    task_name = queued_meta.get("task_name") if queued_meta else None
    accepted_at = queued_meta.get("accepted_at") if queued_meta else None

    if state == "pending" and queued_meta is not None:
        return _task_response(task_id, status="queued", task_name=task_name, accepted_at=accepted_at)
    if state in {"started", "retry"}:
        return _task_response(task_id, status="running", task_name=task_name, accepted_at=accepted_at)
    if celery_task.failed():
        _queued_backtest_tasks.pop(task_id, None)
        return _task_response(
            task_id,
            status="failed",
            task_name=task_name,
            accepted_at=accepted_at,
            error=str(celery_task.result),
        )
    if celery_task.successful():
        _queued_backtest_tasks.pop(task_id, None)
        result_payload = celery_task.result if isinstance(celery_task.result, dict) else {"data": celery_task.result}
        return _task_response(
            task_id,
            status="completed",
            task_name=task_name,
            accepted_at=accepted_at,
            result_payload=result_payload,
        )
    return None


@router.post("/compare")
async def compare_backtest_strategies(
    payload: backtest_v1.BacktestCompareRequest,
    response: Response,
    async_mode: bool = Query(False, alias="async_mode"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if async_mode:
        task_id, accepted_at = _dispatch_task("tasks.backtest_tasks.run_compare_backtest", payload.model_dump())
        response.status_code = 202
        return {
            "data": {"status": "queued", "task_id": task_id, "task_kind": "compare"},
            "meta": {"execution_mode": "celery", "accepted_at": accepted_at, "task_id": task_id},
        }
    result = await backtest_v1.compare_backtest_strategies(payload=payload, db=db)
    return _with_execution_meta(result, execution_mode="sync")


@router.post("/run")
async def run_backtest(
    payload: backtest_v1.BacktestRequest,
    response: Response,
    async_mode: bool = Query(False, alias="async_mode"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if async_mode:
        task_id, accepted_at = _dispatch_task("tasks.backtest_tasks.run_single_backtest", payload.model_dump())
        response.status_code = 202
        return {
            "data": {"status": "queued", "task_id": task_id, "task_kind": "run"},
            "meta": {"execution_mode": "celery", "accepted_at": accepted_at, "task_id": task_id},
        }
    result = await backtest_v1.run_backtest(payload=payload, db=db)
    return _with_execution_meta(result, execution_mode="sync")


@router.post("/lab")
async def run_backtest_lab(
    payload: backtest_v1.BacktestLabRequest,
    response: Response,
    async_mode: bool = Query(False, alias="async_mode"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if async_mode:
        task_id, accepted_at = _dispatch_task("tasks.backtest_tasks.run_lab_backtest", payload.model_dump())
        response.status_code = 202
        return {
            "data": {"status": "queued", "task_id": task_id, "task_kind": "lab"},
            "meta": {"execution_mode": "celery", "accepted_at": accepted_at, "task_id": task_id},
        }
    result = await backtest_v1.run_backtest_lab(payload=payload, db=db)
    return _with_execution_meta(result, execution_mode="sync")


@router.get("/tasks/{task_id}")
async def get_backtest_task(task_id: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    result = await db.execute(
        text(
            """
            SELECT
                t.id,
                t.symbol,
                t.asset_type,
                t.strategy_name,
                t.parameters,
                t.start_date,
                t.end_date,
                t.initial_capital,
                t.status,
                t.created_at,
                r.total_return,
                r.annual_return,
                r.sharpe_ratio,
                r.max_drawdown,
                r.win_rate,
                r.trade_count,
                r.equity_curve,
                r.trade_records,
                r.created_at AS result_created_at
            FROM backtest_tasks t
            LEFT JOIN backtest_results r ON r.task_id = t.id
            WHERE t.id = :task_id
            """
        ),
        {"task_id": task_id},
    )
    row = result.mappings().first()
    if row is None:
        celery_payload = _read_celery_task(task_id)
        if celery_payload is not None:
            return celery_payload
        raise HTTPException(status_code=404, detail={"error": {"code": "NOT_FOUND", "message": "Backtest task not found"}})
    normalized_status = _normalize_task_status(row["status"])
    persisted_result_payload = _build_persisted_run_payload(dict(row))
    return {
        "data": {
            "task_id": str(row["id"]),
            "symbol": row["symbol"],
            "asset_type": row["asset_type"],
            "strategy_name": row["strategy_name"],
            "parameters": row["parameters"],
            "status": normalized_status,
            "task_kind": "run",
            "created_at": row["created_at"],
            "window": {"start_date": row["start_date"], "end_date": row["end_date"]},
            "result": {
                "total_return": row["total_return"],
                "annual_return": row["annual_return"],
                "sharpe_ratio": row["sharpe_ratio"],
                "max_drawdown": row["max_drawdown"],
                "win_rate": row["win_rate"],
                "trade_count": row["trade_count"],
                "equity_curve": row["equity_curve"],
                "trade_records": row["trade_records"],
                "created_at": row["result_created_at"],
            }
            if row["result_created_at"] is not None
            else None,
            "result_payload": persisted_result_payload,
        },
        "meta": {"generated_at": datetime.now(timezone.utc).isoformat(), "execution_mode": "persisted"},
    }
