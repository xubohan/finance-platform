"""Idempotent runtime schema bootstrap for v2 foundation tables."""

from __future__ import annotations

from sqlalchemy import text

from app.database import Base, engine
from app import models  # noqa: F401  # ensure model metadata is registered


DDL_STATEMENTS = (
    """
    ALTER TABLE fundamentals
        ADD COLUMN IF NOT EXISTS total_revenue NUMERIC(24,2),
        ADD COLUMN IF NOT EXISTS total_assets NUMERIC(24,2),
        ADD COLUMN IF NOT EXISTS total_liabilities NUMERIC(24,2),
        ADD COLUMN IF NOT EXISTS equity NUMERIC(24,2),
        ADD COLUMN IF NOT EXISTS operating_cashflow NUMERIC(24,2),
        ADD COLUMN IF NOT EXISTS eps NUMERIC(12,4),
        ADD COLUMN IF NOT EXISTS report_period VARCHAR(10)
    """,
    """
    CREATE TABLE IF NOT EXISTS cn_margin_trading (
        id BIGSERIAL PRIMARY KEY,
        symbol VARCHAR(30) NOT NULL,
        trade_date DATE NOT NULL,
        rzye NUMERIC(20,2),
        rzmre NUMERIC(20,2),
        rqyl NUMERIC(20,2),
        rqmcl NUMERIC(20,2),
        rzrqye NUMERIC(20,2),
        UNIQUE(symbol, trade_date)
    )
    """,
    """CREATE INDEX IF NOT EXISTS idx_margin_date ON cn_margin_trading(trade_date DESC)""",
    """
    CREATE TABLE IF NOT EXISTS cn_northbound_flow (
        id BIGSERIAL PRIMARY KEY,
        trade_date DATE NOT NULL,
        market VARCHAR(5) NOT NULL,
        net_buy NUMERIC(20,2),
        buy_amount NUMERIC(20,2),
        sell_amount NUMERIC(20,2),
        hold_amount NUMERIC(20,2),
        UNIQUE(trade_date, market)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS cn_dragon_tiger (
        id BIGSERIAL PRIMARY KEY,
        symbol VARCHAR(30) NOT NULL,
        trade_date DATE NOT NULL,
        reason TEXT,
        net_buy NUMERIC(20,2),
        buy_amount NUMERIC(20,2),
        sell_amount NUMERIC(20,2),
        top_buyers JSONB,
        top_sellers JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(symbol, trade_date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS cn_big_order_flow (
        id BIGSERIAL PRIMARY KEY,
        symbol VARCHAR(30) NOT NULL,
        trade_date DATE NOT NULL,
        super_large_net NUMERIC(20,2),
        large_net NUMERIC(20,2),
        medium_net NUMERIC(20,2),
        small_net NUMERIC(20,2),
        main_net NUMERIC(20,2),
        UNIQUE(symbol, trade_date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS llm_analysis_cache (
        id BIGSERIAL PRIMARY KEY,
        cache_key VARCHAR(128) UNIQUE NOT NULL,
        task_type VARCHAR(50),
        model VARCHAR(80),
        output JSONB NOT NULL,
        tokens_used INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
    )
    """,
    """CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_analysis_cache(expires_at)""",
    """CREATE UNIQUE INDEX IF NOT EXISTS idx_news_source_id ON news_items(source, source_id) WHERE source_id IS NOT NULL""",
    """CREATE INDEX IF NOT EXISTS idx_news_published ON news_items(published_at DESC)""",
    """CREATE INDEX IF NOT EXISTS idx_news_symbols ON news_items USING GIN(symbols)""",
    """CREATE INDEX IF NOT EXISTS idx_news_markets ON news_items USING GIN(markets)""",
    """CREATE INDEX IF NOT EXISTS idx_news_unprocessed ON news_items(id) WHERE processed = FALSE""",
    """CREATE INDEX IF NOT EXISTS idx_events_date ON market_events(event_date DESC)""",
    """CREATE INDEX IF NOT EXISTS idx_events_type ON market_events(event_type)""",
    """
    CREATE TABLE IF NOT EXISTS market_snapshot_daily (
        trade_date DATE NOT NULL,
        market VARCHAR(10) NOT NULL,
        symbol VARCHAR(30) NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (trade_date, market, symbol)
    )
    """,
    """CREATE INDEX IF NOT EXISTS idx_market_snapshot_daily_market_date ON market_snapshot_daily(market, trade_date DESC)""",
    """
    CREATE TABLE IF NOT EXISTS backtest_cache (
        cache_key VARCHAR(128) PRIMARY KEY,
        category VARCHAR(40) NOT NULL,
        request_payload JSONB NOT NULL,
        response_payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
    )
    """,
    """CREATE INDEX IF NOT EXISTS idx_backtest_cache_expires_at ON backtest_cache(expires_at)""",
)


async def ensure_runtime_schema() -> None:
    """Create new v2 tables and additive columns without destructive changes."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for statement in DDL_STATEMENTS:
            await conn.execute(text(statement))
