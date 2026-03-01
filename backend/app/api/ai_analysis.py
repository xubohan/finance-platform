"""AI analysis API routes with SSE progress streaming."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from typing import Any

import redis
import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai_service:8001")
rds = redis.from_url(REDIS_URL)


class AIRunRequest(BaseModel):
    symbol: str


def _error(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {"code": code, "message": message, "details": details or {}},
        "request_id": "",
    }


def _set_progress(task_id: str, status: str, message: str) -> None:
    rds.setex(
        f"ai:progress:{task_id}",
        3600,
        json.dumps({"status": status, "message": message}, ensure_ascii=False),
    )


async def _execute_ai_task(task_id: str, symbol: str) -> None:
    _set_progress(task_id, "running", "正在调用 ai_service...")

    try:
        def _post_ai() -> dict[str, Any]:
            resp = requests.post(f"{AI_SERVICE_URL}/run", json={"symbol": symbol}, timeout=180)
            resp.raise_for_status()
            return resp.json()

        payload = await asyncio.to_thread(_post_ai)

        result = payload.get("result", {})
        rds.setex(f"ai:result:{task_id}", 3600, json.dumps(result, ensure_ascii=False))
        _set_progress(task_id, "done", "分析完成")
    except Exception as exc:
        _set_progress(task_id, "failed", f"分析失败: {exc}")


@router.post("/run")
async def run_ai(payload: AIRunRequest) -> dict[str, Any]:
    """Submit AI analysis task and return task_id immediately."""
    task_id = str(uuid.uuid4())
    _set_progress(task_id, "pending", "任务已提交")
    asyncio.create_task(_execute_ai_task(task_id, payload.symbol.upper()))
    return {"task_id": task_id, "status": "running"}


@router.get("/stream/{task_id}")
async def stream_ai(task_id: str):
    """Stream task progress as SSE events."""

    async def event_generator():
        last_payload = None
        for _ in range(120):
            raw = rds.get(f"ai:progress:{task_id}")
            if raw:
                payload = raw.decode("utf-8")
                if payload != last_payload:
                    last_payload = payload
                    yield f"event: message\ndata: {payload}\n\n"

                status = json.loads(payload).get("status")
                if status in {"done", "failed"}:
                    break
            await asyncio.sleep(1)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/result/{task_id}")
async def get_ai_result(task_id: str) -> dict[str, Any]:
    """Get final AI analysis result by task ID."""
    raw = rds.get(f"ai:result:{task_id}")
    if not raw:
        raise HTTPException(status_code=404, detail=_error("TASK_NOT_FOUND", "No result for task", {"task_id": task_id}))

    return {"data": json.loads(raw.decode("utf-8"))}
