"""Heuristic sentiment analyzer used as a fast fallback and degraded-mode baseline."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


POSITIVE_TERMS = {
    "beat",
    "bullish",
    "growth",
    "improve",
    "rally",
    "surge",
    "upgrade",
    "上涨",
    "利好",
    "超预期",
    "增长",
    "改善",
    "回暖",
}
NEGATIVE_TERMS = {
    "bearish",
    "downgrade",
    "miss",
    "plunge",
    "risk",
    "selloff",
    "warning",
    "下跌",
    "利空",
    "恶化",
    "裁员",
    "衰退",
}
CATEGORY_KEYWORDS = {
    "earnings": {"earnings", "profit", "guidance", "财报", "净利润", "业绩"},
    "macro": {"fomc", "cpi", "ppi", "pmi", "nonfarm", "利率", "通胀", "经济"},
    "policy": {"policy", "tariff", "regulation", "政策", "监管", "关税"},
    "geopolitical": {"war", "sanction", "geopolitical", "地缘", "冲突", "制裁"},
    "social": {"reddit", "weibo", "tweet", "twitter", "社交"},
}


def _clamp(value: float, lower: float = -1.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def label_for_score(score: float) -> str:
    if score > 0.15:
        return "positive"
    if score < -0.15:
        return "negative"
    return "neutral"


def importance_from_text(text: str) -> int:
    lowered = text.lower()
    if any(keyword in lowered for keyword in ("breaking", "fomc", "cpi", "fed", "停牌", "并购", "违约", "监管")):
        return 5
    if any(keyword in lowered for keyword in ("earnings", "guidance", "业绩", "财报", "回购", "增持")):
        return 4
    if any(keyword in lowered for keyword in ("analyst", "rating", "upgrade", "downgrade", "评级")):
        return 3
    return 2


def categorize_text(text: str) -> str:
    lowered = text.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in lowered or keyword in text for keyword in keywords):
            return category
    return "other"


@dataclass(slots=True)
class SentimentAnalysis:
    score: float
    label: str
    positive_hits: list[str]
    negative_hits: list[str]
    importance: int
    category: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "sentiment_score": self.score,
            "sentiment_label": self.label,
            "positive_hits": self.positive_hits,
            "negative_hits": self.negative_hits,
            "importance": self.importance,
            "category": self.category,
        }


class SentimentAnalyzer:
    """Cheap heuristic analyzer used for low-latency sentiment classification."""

    def analyze(self, text: str, *, title: str = "") -> SentimentAnalysis:
        haystack = f"{title}\n{text}".strip()
        lowered = haystack.lower()
        positive_hits = sorted([term for term in POSITIVE_TERMS if term in lowered or term in haystack])
        negative_hits = sorted([term for term in NEGATIVE_TERMS if term in lowered or term in haystack])
        total = len(positive_hits) + len(negative_hits)
        score = 0.0 if total == 0 else _clamp((len(positive_hits) - len(negative_hits)) / total)
        return SentimentAnalysis(
            score=round(score, 4),
            label=label_for_score(score),
            positive_hits=positive_hits,
            negative_hits=negative_hits,
            importance=importance_from_text(haystack),
            category=categorize_text(haystack),
        )
