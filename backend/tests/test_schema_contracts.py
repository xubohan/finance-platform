"""Schema and Alembic contract tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from pydantic import ValidationError

from app.schemas.market import BatchQuoteRequest, HistorySyncRequest
from app.schemas.news import NewsFeedQuery


def test_market_request_models_enforce_basic_constraints() -> None:
    payload = BatchQuoteRequest(symbols=["AAPL", "SPY"])
    assert payload.symbols == ["AAPL", "SPY"]

    sync_request = HistorySyncRequest(start_date="2026-01-01", end_date="2026-03-01")
    assert sync_request.period == "1d"


def test_news_feed_query_rejects_inverted_sentiment_range() -> None:
    with pytest.raises(ValidationError, match="sentiment_min must be <= sentiment_max"):
        NewsFeedQuery(sentiment_min=0.4, sentiment_max=-0.4)


def test_alembic_baseline_has_single_head_and_foundation_objects() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "migrations"))
    script = ScriptDirectory.from_config(config)

    heads = script.get_heads()
    assert heads == ["20260330_0001"]

    revision = script.get_revision("20260330_0001")
    assert revision is not None
    revision_path = Path(revision.path)
    content = revision_path.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS news_items" in content
    assert "CREATE TABLE IF NOT EXISTS market_events" in content
    assert "CREATE TABLE IF NOT EXISTS watchlist_items" in content
    assert "CREATE TABLE IF NOT EXISTS market_snapshot_daily" in content
    assert "CREATE INDEX IF NOT EXISTS idx_news_unprocessed" in content
