"""TradingAgents execution wrapper."""

from __future__ import annotations

import asyncio
import csv
from datetime import datetime
import json
import os
from typing import Any

import redis
import requests


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
        """Data-driven fallback used when AI provider credentials are unavailable."""
        market_ctx = self._collect_market_context(symbol)
        action = market_ctx["action"]
        confidence = market_ctx["confidence"]

        return {
            "symbol": symbol,
            "date": analysis_date,
            "decision": {
                "action": action,
                "confidence": confidence,
                "reason": market_ctx["decision_reason"],
            },
            "fundamental": market_ctx["fundamental"],
            "sentiment": market_ctx["sentiment"],
            "news": market_ctx["news_summary"],
            "technical": market_ctx["technical"],
            "bull_thesis": market_ctx["bull_thesis"],
            "bear_thesis": market_ctx["bear_thesis"],
            "risk_assessment": market_ctx["risk_assessment"],
            "final_plan": market_ctx["final_plan"],
        }

    def _collect_market_context(self, symbol: str) -> dict[str, Any]:
        """Collect basic market context from public Yahoo endpoints."""
        default = {
            "action": "HOLD",
            "confidence": 0.5,
            "decision_reason": "Provider key unavailable; signal quality reduced.",
            "fundamental": "Live fundamentals unavailable.",
            "sentiment": "Sentiment feed unavailable.",
            "news_summary": "No latest news items retrieved.",
            "technical": "Technical snapshot unavailable.",
            "bull_thesis": "No reliable upside catalyst identified from available fallback feeds.",
            "bear_thesis": "Insufficient data can hide downside risks.",
            "risk_assessment": "Main risk: low-confidence decision due to fallback analysis mode.",
            "final_plan": "Keep position light and rerun AI workflow after model provider is enabled.",
        }

        try:
            yf_resp = requests.get(
                "https://query1.finance.yahoo.com/v7/finance/quote",
                params={"symbols": symbol},
                timeout=8,
                headers={"User-Agent": "finance-platform/0.1"},
            )
            yf_resp.raise_for_status()
            quote_rows = yf_resp.json().get("quoteResponse", {}).get("result", [])
            if not quote_rows:
                return default

            quote = quote_rows[0]
            price = self._to_float(quote.get("regularMarketPrice"))
            change_pct = self._to_float(quote.get("regularMarketChangePercent"))
            pe = self._to_float(quote.get("trailingPE"))
            cap = self._to_float(quote.get("marketCap"))

            action = "HOLD"
            confidence = 0.55
            if change_pct is not None and change_pct > 3:
                action = "BUY"
                confidence = 0.62
            if change_pct is not None and change_pct < -3:
                action = "SELL"
                confidence = 0.62

            default["action"] = action
            default["confidence"] = confidence
            default["decision_reason"] = (
                f"Fallback signal based on latest price momentum ({change_pct:.2f}% daily change)."
                if change_pct is not None
                else "Fallback signal based on limited real-time quote."
            )

            default["fundamental"] = (
                f"Trailing PE: {pe:.2f}; Market cap: {cap:.0f}; Spot price: {price:.2f}."
                if pe is not None and cap is not None and price is not None
                else "Partial fundamentals received from quote feed."
            )
            default["technical"] = (
                f"Latest daily move: {change_pct:.2f}%; spot: {price:.2f}."
                if change_pct is not None and price is not None
                else "Technical momentum unavailable from fallback quote feed."
            )
            default["bull_thesis"] = (
                "Positive short-term momentum supports tactical upside continuation."
                if change_pct is not None and change_pct > 0
                else "Bull case is weak under current fallback momentum signal."
            )
            default["bear_thesis"] = (
                "Negative short-term momentum may continue under risk-off conditions."
                if change_pct is not None and change_pct < 0
                else "Bear case currently lacks strong momentum confirmation."
            )
            default["risk_assessment"] = (
                "Decision is quote-driven without full multi-agent debate; treat as low-confidence."
            )
            default["final_plan"] = (
                "Use tight risk limits and rerun with full AI provider for conviction-grade signal."
            )
        except Exception as exc:
            default["decision_reason"] = f"Fallback quote fetch failed: {exc}"
            # Secondary quote fallback via Stooq daily CSV.
            try:
                stooq_symbol = symbol.lower()
                if symbol.endswith(".SZ") or symbol.endswith(".SH"):
                    stooq_symbol = f"{symbol.split('.')[0].lower()}.cn"
                elif symbol.endswith(".HK"):
                    stooq_symbol = f"{symbol.split('.')[0].lower()}.hk"
                elif "-" in symbol:
                    stooq_symbol = symbol.replace("-", "").lower()
                else:
                    stooq_symbol = f"{symbol.lower()}.us"

                stooq_resp = requests.get(
                    "https://stooq.com/q/d/l/",
                    params={"s": stooq_symbol, "i": "d"},
                    timeout=8,
                    headers={"User-Agent": "finance-platform/0.1"},
                )
                stooq_resp.raise_for_status()
                rows = list(csv.DictReader(stooq_resp.text.splitlines()))
                rows = [row for row in rows if row.get("Close") and row.get("Close") != "N/D"]
                if len(rows) >= 2:
                    latest = float(rows[-1]["Close"])
                    prev = float(rows[-2]["Close"])
                    change_pct = ((latest - prev) / prev * 100) if prev else 0.0
                    default["decision_reason"] = (
                        f"Fallback signal from Stooq quote feed ({change_pct:.2f}% daily change)."
                    )
                    default["fundamental"] = (
                        f"Fallback market snapshot: latest close {latest:.2f}, previous close {prev:.2f}."
                    )
                    default["technical"] = f"Latest daily move: {change_pct:.2f}%; spot: {latest:.2f}."
                    if change_pct > 3:
                        default["action"] = "BUY"
                        default["confidence"] = 0.6
                        default["bull_thesis"] = (
                            "Strong daily upside momentum supports a short-horizon continuation setup."
                        )
                        default["bear_thesis"] = (
                            "Momentum-led rallies can reverse sharply if liquidity fades."
                        )
                    elif change_pct < -3:
                        default["action"] = "SELL"
                        default["confidence"] = 0.6
                        default["bull_thesis"] = (
                            "Capitulation moves can produce reflex rebounds if selling pressure exhausts."
                        )
                        default["bear_thesis"] = (
                            "Large down-day momentum suggests continued downside risk in the next sessions."
                        )
            except Exception:
                pass

        try:
            news_resp = requests.get(
                "https://query1.finance.yahoo.com/v1/finance/search",
                params={"q": symbol, "quotesCount": 0, "newsCount": 3},
                timeout=8,
                headers={"User-Agent": "finance-platform/0.1"},
            )
            news_resp.raise_for_status()
            news_items = news_resp.json().get("news", [])
            if news_items:
                titles = [str(item.get("title", "")).strip() for item in news_items if item.get("title")]
                if titles:
                    default["news_summary"] = " | ".join(titles[:3])
                    default["sentiment"] = "Fallback sentiment derived from latest headlines."
        except Exception:
            pass

        return default

    def _to_float(self, value: Any) -> float | None:
        """Safe numeric conversion helper."""
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _update_progress(self, task_id: str, status: str, message: str):
        self.redis.setex(
            f"ai:progress:{task_id}",
            3600,
            json.dumps({"status": status, "message": message}, ensure_ascii=False),
        )
