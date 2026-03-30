"""News source orchestration and persistence."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import logging
from typing import Any, Callable
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, settings
from app.services.llm_service import LLMService, LLMServiceError
from app.services.news_sources import fetch_rss_feed
from app.services.news_sources.sec_fetcher import fetch_8k
from app.services.news_sources.social_fetcher import fetch_cryptopanic, fetch_reddit
from app.services.news_sources.sse_fetcher import fetch as fetch_sse
from app.services.news_sources.szse_fetcher import fetch as fetch_szse
from app.services.sentiment_analyzer import SentimentAnalyzer
from app.services.symbol_resolver import resolve_symbols

logger = logging.getLogger(__name__)

NEWS_SOURCES: list[dict[str, Any]] = [
    {"id": "sina_finance_cn", "type": "rss", "markets": ["cn"], "url": "https://feed.sina.com.cn/news/finance/stock/index.rss"},
    {"id": "yahoo_finance_us", "type": "rss", "markets": ["us"], "url": "https://finance.yahoo.com/news/rssindex"},
    {"id": "reuters_business", "type": "rss", "markets": ["us"], "url": "https://feeds.reuters.com/reuters/businessNews"},
    {"id": "coindesk_rss", "type": "rss", "markets": ["crypto"], "url": "https://www.coindesk.com/arc/outboundfeeds/rss/"},
    {"id": "reddit_investing", "type": "rss", "markets": ["us"], "url": "https://www.reddit.com/r/investing/.rss"},
    {"id": "sec_edgar_8k", "type": "handler", "markets": ["us"], "handler": fetch_8k},
    {"id": "eastmoney_notice_sh", "type": "handler", "markets": ["cn"], "handler": fetch_sse},
    {"id": "eastmoney_notice_sz", "type": "handler", "markets": ["cn"], "handler": fetch_szse},
    {"id": "cryptopanic", "type": "handler", "markets": ["crypto"], "handler": fetch_cryptopanic},
]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc_datetime(value: Any, *, fallback: datetime | None = None) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    if isinstance(value, str):
        raw = value.strip()
        if raw:
            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    return parsed.replace(tzinfo=timezone.utc)
                return parsed.astimezone(timezone.utc)
            except ValueError:
                pass

    return fallback or _utc_now()


def _content_hash(title: str, url: str | None) -> str:
    return hashlib.sha256(f"{title}|{url or ''}".encode("utf-8")).hexdigest()[:24]


class NewsAggregator:
    """Fetch, enrich, and persist market news."""

    def __init__(self, runtime_settings: Settings | None = None) -> None:
        self.settings = runtime_settings or settings
        self.sentiment = SentimentAnalyzer()
        self.llm = LLMService(self.settings)

    def _selected_sources(self, market: str = "all") -> list[dict[str, Any]]:
        if market == "all":
            return NEWS_SOURCES
        return [source for source in NEWS_SOURCES if market in source["markets"]]

    def _fetch_with_diagnostics(self, market: str = "all", limit_per_source: int = 10) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        selected_sources = self._selected_sources(market)
        items: list[dict[str, Any]] = []
        source_errors: list[dict[str, Any]] = []
        failed_sources: set[str] = set()
        succeeded_sources = 0

        for source in selected_sources:
            source_id = str(source.get("id") or "unknown_source")
            try:
                if source["type"] == "rss":
                    fetched = fetch_rss_feed(
                        source_id=source_id,
                        url=source["url"],
                        markets=source["markets"],
                        limit=limit_per_source,
                    )
                else:
                    handler: Callable[[int], list[dict[str, Any]]] = source["handler"]
                    fetched = handler(limit_per_source)
                succeeded_sources += 1
            except Exception as exc:
                failed_sources.add(source_id)
                source_errors.append(
                    {
                        "source_id": source_id,
                        "stage": "fetch",
                        "error": str(exc),
                    }
                )
                logger.warning("news source fetch failed source=%s market=%s: %s", source_id, market, exc)
                continue

            for item_index, item in enumerate(fetched):
                try:
                    text_blob = f"{item.get('title', '')}\n{item.get('content', '')}"
                    heuristic = self.sentiment.analyze(item.get("content", ""), title=item.get("title", ""))
                    normalized_item = dict(item)
                    normalized_item["source_id"] = normalized_item.get("source_id") or _content_hash(
                        normalized_item.get("title", ""),
                        normalized_item.get("url"),
                    )
                    normalized_item["symbols"] = resolve_symbols(
                        text_blob,
                        default_market=source["markets"][0] if source["markets"] else None,
                    )
                    normalized_item["categories"] = [heuristic.category]
                    normalized_item["sentiment"] = heuristic.score
                    normalized_item["importance"] = heuristic.importance
                    normalized_item["llm_summary"] = None
                    normalized_item["llm_impact"] = None
                    normalized_item["llm_key_factors"] = []
                    normalized_item["processed"] = False
                    normalized_item["published_at"] = _to_utc_datetime(normalized_item.get("published_at"))
                    normalized_item["created_at"] = _to_utc_datetime(normalized_item.get("created_at"), fallback=_utc_now())
                    items.append(normalized_item)
                except Exception as exc:
                    source_errors.append(
                        {
                            "source_id": source_id,
                            "stage": "normalize",
                            "item_index": item_index,
                            "error": str(exc),
                        }
                    )
                    logger.warning("news item normalize failed source=%s idx=%d: %s", source_id, item_index, exc)
                    continue

        diagnostics = {
            "market": market,
            "sources_total": len(selected_sources),
            "sources_succeeded": succeeded_sources,
            "sources_failed": len(failed_sources),
            "degraded": bool(source_errors),
            "partial": bool(source_errors) and succeeded_sources > 0,
            "source_errors": source_errors,
            "generated_at": _utc_now().isoformat(),
        }
        return items, diagnostics

    def fetch(self, market: str = "all", limit_per_source: int = 10) -> list[dict[str, Any]]:
        items, _ = self._fetch_with_diagnostics(market=market, limit_per_source=limit_per_source)
        return items

    async def persist(self, db: AsyncSession, items: list[dict[str, Any]]) -> dict[str, int]:
        if not items:
            return {"inserted": 0, "updated": 0}

        inserted = 0
        updated = 0
        for item in items:
            normalized_item = {
                **item,
                "published_at": _to_utc_datetime(item.get("published_at")),
                "created_at": _to_utc_datetime(item.get("created_at"), fallback=_utc_now()),
            }
            result = await db.execute(
                text(
                    """
                    INSERT INTO news_items(
                        source, source_id, title, content, url, published_at, symbols, categories, markets,
                        sentiment, importance, llm_summary, llm_impact, llm_key_factors, processed, created_at
                    ) VALUES (
                        :source, :source_id, :title, :content, :url, :published_at, :symbols, :categories, :markets,
                        :sentiment, :importance, :llm_summary, :llm_impact, :llm_key_factors, :processed, :created_at
                    )
                    ON CONFLICT (source, source_id) WHERE source_id IS NOT NULL DO UPDATE SET
                        title = EXCLUDED.title,
                        content = COALESCE(EXCLUDED.content, news_items.content),
                        url = COALESCE(EXCLUDED.url, news_items.url),
                        published_at = EXCLUDED.published_at,
                        symbols = EXCLUDED.symbols,
                        categories = EXCLUDED.categories,
                        markets = EXCLUDED.markets,
                        sentiment = EXCLUDED.sentiment,
                        importance = EXCLUDED.importance
                    RETURNING (xmax = 0) AS inserted
                    """
                ),
                normalized_item,
            )
            inserted_flag = bool(result.scalar_one())
            if inserted_flag:
                inserted += 1
            else:
                updated += 1
            category = (normalized_item.get("categories") or ["other"])[0]
            if int(normalized_item.get("importance") or 0) >= 4 or category in {"macro", "policy", "earnings", "geopolitical"}:
                published_at = normalized_item["published_at"]
                await db.execute(
                    text(
                        """
                        INSERT INTO market_events(title, event_type, event_date, event_time, symbols, markets, description, importance, source, source_url, created_at)
                        SELECT
                            :title, :event_type, :event_date, :event_time, :symbols, :markets, :description, :importance, :source, :source_url, :created_at
                        WHERE NOT EXISTS (
                            SELECT 1 FROM market_events
                            WHERE title = :title AND event_date = :event_date
                        )
                        """
                    ),
                    {
                        "title": normalized_item["title"],
                        "event_type": category,
                        "event_date": published_at.date(),
                        "event_time": published_at,
                        "symbols": normalized_item.get("symbols", []),
                        "markets": normalized_item.get("markets", []),
                        "description": normalized_item.get("content"),
                        "importance": normalized_item.get("importance", 3),
                        "source": normalized_item.get("source"),
                        "source_url": normalized_item.get("url"),
                        "created_at": _utc_now(),
                    },
                )
        await db.commit()
        return {"inserted": inserted, "updated": updated}

    async def fetch_and_store(self, db: AsyncSession, market: str = "all", limit_per_source: int = 10) -> dict[str, Any]:
        items, diagnostics = self._fetch_with_diagnostics(market=market, limit_per_source=limit_per_source)
        stats = await self.persist(db, items)
        return {"count": len(items), **stats, **diagnostics}

    async def process_pending_llm(self, db: AsyncSession, batch_size: int | None = None) -> dict[str, int]:
        limit = batch_size or self.settings.news_llm_batch_size
        result = await db.execute(
            text(
                """
                SELECT id, title, content, symbols
                FROM news_items
                WHERE processed = FALSE
                ORDER BY published_at DESC, id DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        )
        rows = result.mappings().all()
        processed = 0
        failed = 0
        for row in rows:
            try:
                if self.llm.enabled:
                    payload, _ = await self.llm.analyze_news(
                        title=row["title"],
                        content=row["content"] or "",
                        symbols=list(row["symbols"] or []),
                    )
                else:
                    heuristic = self.sentiment.analyze(row["content"] or "", title=row["title"])
                    payload = {
                        "sentiment": heuristic.score,
                        "importance": heuristic.importance,
                        "summary": (row["content"] or row["title"])[:180],
                        "impact_assessment": "LLM 未配置，当前为启发式摘要。",
                        "key_factors": heuristic.positive_hits[:3] + heuristic.negative_hits[:3],
                        "category": heuristic.category,
                    }
                await db.execute(
                    text(
                        """
                        UPDATE news_items
                        SET sentiment = :sentiment,
                            importance = :importance,
                            llm_summary = :summary,
                            llm_impact = :impact_assessment,
                            llm_key_factors = :key_factors,
                            categories = ARRAY[:category]::text[],
                            processed = TRUE
                        WHERE id = :id
                        """
                    ),
                    {
                        "id": row["id"],
                        "sentiment": payload.get("sentiment", 0.0),
                        "importance": payload.get("importance", 2),
                        "summary": payload.get("summary"),
                        "impact_assessment": payload.get("impact_assessment"),
                        "key_factors": payload.get("key_factors", []),
                        "category": payload.get("category", "other"),
                    },
                )
                processed += 1
            except (LLMServiceError, Exception):
                await db.rollback()
                failed += 1
        await db.commit()
        return {"processed": processed, "failed": failed}
