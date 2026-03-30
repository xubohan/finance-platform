"""OpenAI-compatible LLM service with configurable model, style, and endpoint path."""

from __future__ import annotations

from dataclasses import dataclass
import json
import logging
from typing import Any

import httpx

try:
    from openai import AsyncOpenAI
except Exception:  # pragma: no cover - host-local test env may omit SDK
    AsyncOpenAI = None

from app.config import Settings, settings

logger = logging.getLogger(__name__)


class LLMServiceError(RuntimeError):
    """Raised when an upstream LLM call fails."""


def _join_url(base_url: str, endpoint_path: str) -> str:
    base = base_url.rstrip("/")
    path = endpoint_path if endpoint_path.startswith("/") else f"/{endpoint_path}"
    return f"{base}{path}"


def _extract_json_candidate(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if not candidate:
        raise LLMServiceError("empty llm response")

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start >= 0 and end > start:
            return json.loads(candidate[start : end + 1])
        raise LLMServiceError("llm response is not valid json")


def _extract_response_text(payload: dict[str, Any]) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message", {})
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content

    output = payload.get("output")
    if isinstance(output, list):
        text_parts: list[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "message":
                for content in item.get("content", []):
                    if not isinstance(content, dict):
                        continue
                    if content.get("type") in {"output_text", "text"} and isinstance(content.get("text"), str):
                        text_parts.append(content["text"])
            elif item.get("type") in {"output_text", "text"} and isinstance(item.get("text"), str):
                text_parts.append(item["text"])
        if text_parts:
            return "\n".join(text_parts)

    raise LLMServiceError("unable to extract text from llm response")


@dataclass(slots=True)
class LLMCallMetadata:
    model: str
    provider: str
    api_style: str
    endpoint_path: str
    tokens_used: int
    processing_ms: int | None


class LLMService:
    """Thin OpenAI-compatible wrapper with configurable endpoint path."""

    def __init__(self, runtime_settings: Settings | None = None) -> None:
        self.settings = runtime_settings or settings
        self.model = self.settings.llm_model

    @property
    def enabled(self) -> bool:
        return bool(self.settings.enable_llm_analysis and self.settings.llm_api_key.strip())

    def summary(self) -> dict[str, Any]:
        return {
            "configured": self.enabled,
            "model": self.settings.llm_model,
            "api_style": self.settings.llm_api_style,
            "base_url": self.settings.llm_base_url,
            "endpoint_path": self.settings.llm_endpoint_path,
            "reasoning_effort": self.settings.llm_reasoning_effort,
        }

    def _sdk_base_url(self) -> str:
        base = self.settings.llm_base_url.rstrip("/")
        if base.endswith("/v1"):
            return base
        return f"{base}/v1"

    async def _call_standard_sdk(self, *, system_prompt: str, user_prompt: str) -> tuple[str, LLMCallMetadata]:
        if AsyncOpenAI is None:
            raise LLMServiceError("openai sdk is unavailable")
        client = AsyncOpenAI(
            api_key=self.settings.llm_api_key,
            base_url=self._sdk_base_url(),
            timeout=self.settings.llm_timeout_sec,
        )
        if self.settings.llm_api_style == "responses":
            response = await client.responses.create(
                model=self.model,
                input=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                reasoning={"effort": self.settings.llm_reasoning_effort},
                max_output_tokens=self.settings.llm_max_tokens,
                text={"verbosity": self.settings.llm_text_verbosity},
            )
            usage = getattr(response, "usage", None)
            tokens_used = 0 if usage is None else int(getattr(usage, "total_tokens", 0) or 0)
            processing_ms = getattr(response, "processing_ms", None)
            return response.output_text, LLMCallMetadata(
                model=self.model,
                provider="openai-compatible",
                api_style=self.settings.llm_api_style,
                endpoint_path=self.settings.llm_endpoint_path,
                tokens_used=tokens_used,
                processing_ms=int(processing_ms) if processing_ms is not None else None,
            )

        response = await client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_completion_tokens=self.settings.llm_max_tokens,
            reasoning_effort=self.settings.llm_reasoning_effort,
        )
        usage = getattr(response, "usage", None)
        tokens_used = 0 if usage is None else int(getattr(usage, "total_tokens", 0) or 0)
        content = response.choices[0].message.content or ""
        return content, LLMCallMetadata(
            model=self.model,
            provider="openai-compatible",
            api_style=self.settings.llm_api_style,
            endpoint_path=self.settings.llm_endpoint_path,
            tokens_used=tokens_used,
            processing_ms=None,
        )

    async def _call_custom_http(self, *, system_prompt: str, user_prompt: str) -> tuple[str, LLMCallMetadata]:
        headers = {
            "Authorization": f"Bearer {self.settings.llm_api_key}",
            "Content-Type": "application/json",
        }
        body: dict[str, Any]
        if self.settings.llm_api_style == "responses":
            body = {
                "model": self.model,
                "input": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "reasoning": {"effort": self.settings.llm_reasoning_effort},
                "text": {"verbosity": self.settings.llm_text_verbosity},
                "max_output_tokens": self.settings.llm_max_tokens,
            }
        else:
            body = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "reasoning_effort": self.settings.llm_reasoning_effort,
                "max_tokens": self.settings.llm_max_tokens,
            }

        url = _join_url(self.settings.llm_base_url, self.settings.llm_endpoint_path)
        async with httpx.AsyncClient(timeout=self.settings.llm_timeout_sec) as client:
            response = await client.post(url, headers=headers, json=body)
            response.raise_for_status()
            payload = response.json()

        usage = payload.get("usage", {})
        return _extract_response_text(payload), LLMCallMetadata(
            model=self.model,
            provider="openai-compatible",
            api_style=self.settings.llm_api_style,
            endpoint_path=self.settings.llm_endpoint_path,
            tokens_used=int(usage.get("total_tokens", 0) or 0),
            processing_ms=payload.get("processing_ms"),
        )

    async def request_json(self, *, system_prompt: str, user_prompt: str) -> tuple[dict[str, Any], LLMCallMetadata]:
        if not self.enabled:
            raise LLMServiceError("llm is not configured")

        try:
            standard_responses = self.settings.llm_api_style == "responses" and self.settings.llm_endpoint_path == "/v1/responses"
            standard_chat = self.settings.llm_api_style == "chat_completions" and self.settings.llm_endpoint_path == "/v1/chat/completions"
            if standard_responses or standard_chat:
                text, meta = await self._call_standard_sdk(system_prompt=system_prompt, user_prompt=user_prompt)
            else:
                text, meta = await self._call_custom_http(system_prompt=system_prompt, user_prompt=user_prompt)
        except Exception as exc:
            logger.warning("LLM request failed style=%s endpoint=%s: %s", self.settings.llm_api_style, self.settings.llm_endpoint_path, exc)
            raise LLMServiceError(str(exc)) from exc
        return _extract_json_candidate(text), meta

    async def analyze_news(self, *, title: str, content: str, symbols: list[str]) -> tuple[dict[str, Any], LLMCallMetadata]:
        system_prompt = (
            "你是金融新闻分析器。必须只返回 JSON 对象，不要返回 Markdown、解释或代码块。"
            "字段必须包含 sentiment, importance, summary, impact_assessment, key_factors, category。"
        )
        user_prompt = (
            f"标题：{title}\n"
            f"内容：{content[:1800]}\n"
            f"关联标的：{', '.join(symbols) if symbols else '未知'}\n"
            '请输出 JSON：{"sentiment":0.0,"importance":1,"summary":"","impact_assessment":"","key_factors":[],"category":"macro"}'
        )
        return await self.request_json(system_prompt=system_prompt, user_prompt=user_prompt)

    async def analyze_event_impact(
        self,
        *,
        event_text: str,
        event_type: str,
        historical_stats: dict[str, Any],
        target_symbols: list[str],
    ) -> tuple[dict[str, Any], LLMCallMetadata]:
        system_prompt = (
            "你是量化研究和事件驱动交易分析师。必须只返回 JSON 对象。"
            "请结合给定历史统计，输出情绪、摘要、风险和按标的方向判断。"
        )
        user_prompt = (
            f"事件类型：{event_type}\n"
            f"事件内容：{event_text[:2400]}\n"
            f"目标标的：{', '.join(target_symbols) if target_symbols else '无'}\n"
            f"历史统计：{json.dumps(historical_stats, ensure_ascii=False)}\n"
            '{"sentiment_score":0.0,"sentiment_label":"neutral","summary":"","key_factors":[],"risk_factors":[],"impact_assessment":"","symbol_analysis":{}}'
        )
        return await self.request_json(system_prompt=system_prompt, user_prompt=user_prompt)
