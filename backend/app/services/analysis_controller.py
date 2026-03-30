"""Runtime controller for sentiment and event-impact workflows."""

from __future__ import annotations

from datetime import datetime, timezone
import html
import re
from typing import Any
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, settings
from app.schemas.analysis import EventImpactRequest
from app.services.event_impact_engine import EventImpactEngine
from app.services.llm_service import LLMService, LLMServiceError
from app.services.sentiment_analyzer import SentimentAnalyzer

try:
    from celery.result import AsyncResult
    from tasks.celery_app import celery_app
except Exception:  # pragma: no cover - host-local test env may not install celery
    AsyncResult = None
    celery_app = None

LOCAL_TASK_RESULTS: dict[str, dict[str, Any]] = {}

_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_HTML_BREAK_RE = re.compile(r"<\s*(?:br|/p|/div|/li|/blockquote|/h[1-6])\s*/?>", re.I)
_HTML_OPEN_BLOCK_RE = re.compile(r"<\s*(?:p|div|li|blockquote|h[1-6])[^>]*>", re.I)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", re.I)
_URL_RE = re.compile(r"https?://[^\s)]+", re.I)
_REDDIT_TRAILER_RE = re.compile(r"\bsubmitted by\b.*$", re.I | re.S)


def _plain_text_preview(value: str, max_length: int = 180) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    text = _HTML_COMMENT_RE.sub(" ", text)
    text = _HTML_BREAK_RE.sub("\n", text)
    text = _HTML_OPEN_BLOCK_RE.sub("\n", text)
    text = _MARKDOWN_LINK_RE.sub(r"\1", text)
    text = _HTML_TAG_RE.sub(" ", text)
    text = html.unescape(text)
    text = _URL_RE.sub(" ", text)
    text = _REDDIT_TRAILER_RE.sub(" ", text)
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\s*\n\s*", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return ""
    if len(text) <= max_length:
        return text
    return f"{text[: max_length - 1].rstrip()}…"


class AnalysisController:
    """Coordinates local heuristics, LLM inference, and task execution state."""

    def __init__(self, runtime_settings: Settings | None = None) -> None:
        self.settings = runtime_settings or settings
        self.sentiment = SentimentAnalyzer()
        self.llm = LLMService(self.settings)
        self.event_engine = EventImpactEngine()

    async def analyze_sentiment(self, *, text: str, context_symbols: list[str]) -> dict[str, Any]:
        result = self.sentiment.analyze(text)
        return {
            "data": {
                "sentiment_score": result.score,
                "sentiment_label": result.label,
                "positive_hits": result.positive_hits,
                "negative_hits": result.negative_hits,
                "context_symbols": [symbol.upper() for symbol in context_symbols],
            },
            "meta": {
                "method": "heuristic",
                "generated_at": datetime.now(timezone.utc).isoformat(),
            },
        }

    async def run_event_impact(self, *, db: AsyncSession, payload: EventImpactRequest) -> dict[str, Any]:
        heuristic = self.sentiment.analyze(payload.event_text)
        historical_context, predictions = await self.event_engine.historical_context(
            db,
            event_type=payload.event_type,
            symbols=[symbol.upper() for symbol in payload.symbols],
        )

        llm_analysis = {
            "summary": _plain_text_preview(payload.event_text, max_length=180) or "Event summary unavailable.",
            "key_factors": heuristic.positive_hits[:3],
            "risk_factors": heuristic.negative_hits[:3],
            "impact_assessment": "LLM 未配置，当前为启发式事件影响分析。",
        }
        model_used = "heuristic-v1"
        tokens_used = 0
        processing_ms = None
        degraded = not self.llm.enabled
        degraded_reason = None if self.llm.enabled else "llm_disabled"
        if self.llm.enabled:
            try:
                llm_payload, llm_meta = await self.llm.analyze_event_impact(
                    event_text=payload.event_text,
                    event_type=payload.event_type,
                    historical_stats={"context": historical_context, "predictions": predictions},
                    target_symbols=[symbol.upper() for symbol in payload.symbols],
                )
                llm_analysis = {
                    "summary": llm_payload.get("summary") or llm_analysis["summary"],
                    "key_factors": llm_payload.get("key_factors") or llm_analysis["key_factors"],
                    "risk_factors": llm_payload.get("risk_factors") or llm_analysis["risk_factors"],
                    "impact_assessment": llm_payload.get("impact_assessment") or llm_analysis["impact_assessment"],
                }
                symbol_analysis = llm_payload.get("symbol_analysis", {})
                for prediction in predictions:
                    symbol_payload = symbol_analysis.get(prediction["symbol"], {})
                    prediction["predicted_direction"] = symbol_payload.get("direction") or ("up" if prediction["historical_avg_return_5d"] >= 0 else "down")
                    prediction["confidence"] = symbol_payload.get("confidence") or max(0.35, min(0.9, abs(prediction["historical_avg_return_5d"]) / 10 + 0.4))
                    prediction["basis"] = symbol_payload.get("reasoning") or "基于历史样本统计与 LLM 事件分析。"
                model_used = llm_meta.model
                tokens_used = llm_meta.tokens_used
                processing_ms = llm_meta.processing_ms
            except LLMServiceError as exc:
                degraded = True
                degraded_reason = f"llm_error:{exc.__class__.__name__}"

        for prediction in predictions:
            prediction.setdefault("predicted_direction", "up" if prediction["historical_avg_return_5d"] >= 0 else "down")
            prediction.setdefault("confidence", max(0.35, min(0.9, abs(prediction["historical_avg_return_5d"]) / 10 + 0.4)))
            prediction.setdefault("basis", "基于历史样本统计与启发式情绪分析。")
            prediction["return_distribution"] = {
                "p10": round(prediction["historical_avg_return_5d"] - 1.2, 4),
                "p25": round(prediction["historical_avg_return_5d"] - 0.5, 4),
                "p50": round(prediction["historical_avg_return_5d"], 4),
                "p75": round(prediction["historical_avg_return_5d"] + 0.8, 4),
                "p90": round(prediction["historical_avg_return_5d"] + 1.8, 4),
            }

        return {
            "data": {
                "sentiment_score": heuristic.score,
                "sentiment_label": heuristic.label,
                "llm_analysis": llm_analysis,
                "historical_context": historical_context,
                "symbol_predictions": predictions,
            },
            "meta": {
                "task_id": "",
                "model_used": model_used,
                "tokens_used": tokens_used,
                "processing_ms": processing_ms or 0,
                "degraded": degraded,
                "degraded_reason": degraded_reason,
            },
        }

    def queue_local_result(self, result: dict[str, Any]) -> str:
        task_id = f"local-{uuid.uuid4()}"
        result["meta"]["task_id"] = task_id
        LOCAL_TASK_RESULTS[task_id] = {"status": "completed", "result": result}
        return task_id

    def register_remote_task(self, task_id: str, *, backend: str = "celery") -> str:
        LOCAL_TASK_RESULTS[task_id] = {
            "status": "pending",
            "backend": backend,
            "task_id": task_id,
        }
        return task_id

    def get_task_status(self, task_id: str) -> dict[str, Any]:
        local = LOCAL_TASK_RESULTS.get(task_id)
        if local is not None and local.get("backend") != "celery":
            return local

        if local is not None and local.get("backend") == "celery":
            if AsyncResult is None or celery_app is None:
                return {"status": "pending", "task_id": task_id, "backend": "celery"}

            task = AsyncResult(task_id, app=celery_app)
            if task.failed():
                payload = {"status": "failed", "error": str(task.result), "task_id": task_id, "backend": "celery"}
                LOCAL_TASK_RESULTS[task_id] = payload
                return payload
            if task.successful():
                result = task.result
                if isinstance(result, dict):
                    meta = result.setdefault("meta", {})
                    if isinstance(meta, dict):
                        meta["task_id"] = task_id
                payload = {"status": "completed", "result": result, "task_id": task_id, "backend": "celery"}
                LOCAL_TASK_RESULTS[task_id] = payload
                return payload
            if task.state.lower() in {"pending", "received", "started", "retry"}:
                return {"status": "pending", "task_id": task_id, "backend": "celery"}
            return {"status": task.state.lower(), "task_id": task_id, "backend": "celery"}

        if AsyncResult is None or celery_app is None:
            return {"status": "not_found"}

        task = AsyncResult(task_id, app=celery_app)
        if task.failed():
            return {"status": "failed", "error": str(task.result)}
        if task.successful():
            result = task.result
            if isinstance(result, dict):
                meta = result.setdefault("meta", {})
                if isinstance(meta, dict):
                    meta["task_id"] = task_id
            return {"status": "completed", "result": result, "task_id": task_id, "backend": "celery"}
        state = task.state.lower()
        if state == "pending":
            return {"status": "not_found"}
        if state in {"received", "started", "retry"}:
            return {"status": "pending", "task_id": task_id, "backend": "celery"}
        return {"status": state, "task_id": task_id, "backend": "celery"}
