"""Helpers for normalizing AI report payloads."""

from __future__ import annotations

from typing import Any


def normalize_report(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize report dictionary into expected response keys."""
    return {
        "symbol": raw.get("symbol", ""),
        "date": raw.get("date", ""),
        "decision": raw.get("decision", {}),
        "fundamental": raw.get("fundamental", ""),
        "sentiment": raw.get("sentiment", ""),
        "news": raw.get("news", ""),
        "technical": raw.get("technical", ""),
        "bull_thesis": raw.get("bull_thesis", ""),
        "bear_thesis": raw.get("bear_thesis", ""),
        "risk_assessment": raw.get("risk_assessment", ""),
        "final_plan": raw.get("final_plan", ""),
    }
