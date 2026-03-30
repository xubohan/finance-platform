"""Celery tasks for asynchronous backtest flows."""

from __future__ import annotations

import asyncio

from app.api import backtest as backtest_v1
from app.database import get_task_db_session
from tasks.celery_app import celery_app


@celery_app.task(name="tasks.backtest_tasks.run_single_backtest")
def run_single_backtest(payload: dict[str, object]) -> dict[str, object]:
    async def _run() -> dict[str, object]:
        request = backtest_v1.BacktestRequest.model_validate(payload)
        async with get_task_db_session() as session:
            return await backtest_v1.run_backtest(payload=request, db=session)

    return asyncio.run(_run())


@celery_app.task(name="tasks.backtest_tasks.run_compare_backtest")
def run_compare_backtest(payload: dict[str, object]) -> dict[str, object]:
    async def _run() -> dict[str, object]:
        request = backtest_v1.BacktestCompareRequest.model_validate(payload)
        async with get_task_db_session() as session:
            return await backtest_v1.compare_backtest_strategies(payload=request, db=session)

    return asyncio.run(_run())


@celery_app.task(name="tasks.backtest_tasks.run_lab_backtest")
def run_lab_backtest(payload: dict[str, object]) -> dict[str, object]:
    async def _run() -> dict[str, object]:
        request = backtest_v1.BacktestLabRequest.model_validate(payload)
        async with get_task_db_session() as session:
            return await backtest_v1.run_backtest_lab(payload=request, db=session)

    return asyncio.run(_run())
