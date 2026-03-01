"""TradingAgents execution wrapper."""

from __future__ import annotations

import asyncio
from datetime import datetime
import json
import os
from typing import Any

import redis


class AgentRunner:
    """Run multi-agent analysis with fallback when provider is unavailable."""

    def __init__(self):
        self.redis = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/3"))
        self.use_tradingagents = True
        try:
            from tradingagents.default_config import DEFAULT_CONFIG

            self._default_config = DEFAULT_CONFIG
        except Exception:
            self.use_tradingagents = False
            self._default_config = {}

    async def run(self, symbol: str, task_id: str) -> dict[str, Any]:
        """Execute AI analysis and persist progress/result in Redis."""
        symbol = symbol.upper().strip()
        analysis_date = datetime.today().strftime("%Y-%m-%d")

        self._update_progress(task_id, "running", "正在初始化分析智能体...")

        result: dict[str, Any]
        if self.use_tradingagents and os.getenv("ANTHROPIC_API_KEY"):
            try:
                result = await self._run_tradingagents(symbol, analysis_date)
            except Exception:
                result = self._fallback_result(symbol, analysis_date)
        else:
            result = self._fallback_result(symbol, analysis_date)

        self.redis.setex(f"ai:result:{task_id}", 3600, json.dumps(result, ensure_ascii=False))
        self._update_progress(task_id, "done", "分析完成")
        return result

    async def _run_tradingagents(self, symbol: str, analysis_date: str) -> dict[str, Any]:
        """Run real TradingAgents graph when dependencies and key are ready."""
        from tradingagents.default_config import DEFAULT_CONFIG
        from tradingagents.graph.trading_graph import TradingAgentsGraph

        config = {
            **DEFAULT_CONFIG,
            "llm_provider": "anthropic",
            "deep_think_llm": "claude-sonnet-4-5",
            "quick_think_llm": "claude-haiku-4-5",
            "max_debate_rounds": 1,
            "online_tools": True,
        }

        ta = TradingAgentsGraph(debug=False, config=config)
        loop = asyncio.get_event_loop()
        state, decision = await loop.run_in_executor(None, lambda: ta.propagate(symbol, analysis_date))

        return {
            "symbol": symbol,
            "date": analysis_date,
            "decision": decision,
            "fundamental": state.get("fundamentals_report", ""),
            "sentiment": state.get("sentiment_report", ""),
            "news": state.get("news_report", ""),
            "technical": state.get("technical_report", ""),
            "bull_thesis": state.get("bull_research_report", ""),
            "bear_thesis": state.get("bear_research_report", ""),
            "risk_assessment": state.get("risk_report", ""),
            "final_plan": state.get("investment_plan", ""),
        }

    def _fallback_result(self, symbol: str, analysis_date: str) -> dict[str, Any]:
        """Deterministic fallback used in offline/no-key environments."""
        return {
            "symbol": symbol,
            "date": analysis_date,
            "decision": {
                "action": "HOLD",
                "confidence": 0.51,
                "reason": "Fallback mode: provider unavailable",
            },
            "fundamental": "Fallback summary: valuation and profitability need full provider data.",
            "sentiment": "Fallback summary: sentiment data unavailable in offline mode.",
            "news": "Fallback summary: no live news feed attached.",
            "technical": "Fallback summary: wait for trend confirmation.",
            "bull_thesis": "AI provider unavailable; bull thesis placeholder.",
            "bear_thesis": "AI provider unavailable; bear thesis placeholder.",
            "risk_assessment": "Primary risk: data incompleteness in fallback mode.",
            "final_plan": "Hold and monitor; rerun when AI provider is enabled.",
        }

    def _update_progress(self, task_id: str, status: str, message: str):
        self.redis.setex(
            f"ai:progress:{task_id}",
            3600,
            json.dumps({"status": status, "message": message}, ensure_ascii=False),
        )
