"""AI analysis microservice entrypoint."""

from __future__ import annotations

import uuid

from fastapi import FastAPI
from pydantic import BaseModel

from agent_runner import AgentRunner

app = FastAPI(title="Finance Terminal AI Service", version="0.1.0")
runner = AgentRunner()


class AIRunRequest(BaseModel):
    symbol: str


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/run")
async def run_analysis(payload: AIRunRequest) -> dict:
    task_id = str(uuid.uuid4())
    result = await runner.run(payload.symbol, task_id)
    return {"task_id": task_id, "result": result}
