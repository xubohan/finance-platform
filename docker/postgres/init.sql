-- ============================================================
-- 金融分析终端数据库初始化脚本
-- 执行顺序：扩展 -> 基础表 -> TimescaleDB超表 -> 索引 -> 保留策略
-- ============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 资产基础信息表（股票 + 加密货币共用）
CREATE TABLE IF NOT EXISTS assets (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(30) NOT NULL,
    name VARCHAR(100) NOT NULL,
    asset_type VARCHAR(10) NOT NULL,
    market VARCHAR(10),
    industry VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(symbol, asset_type)
);

CREATE INDEX IF NOT EXISTS idx_assets_symbol ON assets(symbol);
CREATE INDEX IF NOT EXISTS idx_assets_name_trgm ON assets USING GIN(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);

-- 日线行情表（TimescaleDB超表，股票+加密共用）
CREATE TABLE IF NOT EXISTS ohlcv_daily (
    time TIMESTAMPTZ NOT NULL,
    symbol VARCHAR(30) NOT NULL,
    asset_type VARCHAR(10) NOT NULL,
    open NUMERIC(20,8) NOT NULL,
    high NUMERIC(20,8) NOT NULL,
    low NUMERIC(20,8) NOT NULL,
    close NUMERIC(20,8) NOT NULL,
    volume NUMERIC(24,4) NOT NULL,
    UNIQUE(time, symbol, asset_type)
);

SELECT create_hypertable('ohlcv_daily', 'time', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol_time
ON ohlcv_daily(symbol, asset_type, time DESC);

-- 财务数据表（仅股票）
CREATE TABLE IF NOT EXISTS fundamentals (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(30) NOT NULL,
    report_date DATE NOT NULL,
    pe_ttm NUMERIC(12,4),
    pb NUMERIC(12,4),
    roe NUMERIC(10,4),
    revenue NUMERIC(24,2),
    net_income NUMERIC(24,2),
    revenue_yoy NUMERIC(10,4),
    profit_yoy NUMERIC(10,4),
    market_cap NUMERIC(24,2),
    UNIQUE(symbol, report_date)
);

ALTER TABLE fundamentals
    ADD COLUMN IF NOT EXISTS total_revenue NUMERIC(24,2),
    ADD COLUMN IF NOT EXISTS total_assets NUMERIC(24,2),
    ADD COLUMN IF NOT EXISTS total_liabilities NUMERIC(24,2),
    ADD COLUMN IF NOT EXISTS equity NUMERIC(24,2),
    ADD COLUMN IF NOT EXISTS operating_cashflow NUMERIC(24,2),
    ADD COLUMN IF NOT EXISTS eps NUMERIC(12,4),
    ADD COLUMN IF NOT EXISTS report_period VARCHAR(10);

-- 回测任务表
CREATE TABLE IF NOT EXISTS backtest_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(30) NOT NULL,
    asset_type VARCHAR(10) NOT NULL,
    strategy_name VARCHAR(50) NOT NULL,
    parameters JSONB NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    initial_capital NUMERIC(18,2) DEFAULT 1000000,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 回测结果表
CREATE TABLE IF NOT EXISTS backtest_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES backtest_tasks(id) ON DELETE CASCADE,
    total_return NUMERIC(10,4),
    annual_return NUMERIC(10,4),
    sharpe_ratio NUMERIC(10,4),
    max_drawdown NUMERIC(10,4),
    win_rate NUMERIC(10,4),
    trade_count INTEGER,
    equity_curve JSONB,
    trade_records JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- A股专项扩展
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
);

CREATE INDEX IF NOT EXISTS idx_margin_date ON cn_margin_trading(trade_date DESC);

CREATE TABLE IF NOT EXISTS cn_northbound_flow (
    id BIGSERIAL PRIMARY KEY,
    trade_date DATE NOT NULL,
    market VARCHAR(5) NOT NULL,
    net_buy NUMERIC(20,2),
    buy_amount NUMERIC(20,2),
    sell_amount NUMERIC(20,2),
    hold_amount NUMERIC(20,2),
    UNIQUE(trade_date, market)
);

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
);

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
);

-- 新闻与事件
CREATE TABLE IF NOT EXISTS news_items (
    id BIGSERIAL PRIMARY KEY,
    source VARCHAR(60) NOT NULL,
    source_id VARCHAR(300),
    title TEXT NOT NULL,
    content TEXT,
    url TEXT,
    published_at TIMESTAMPTZ NOT NULL,
    symbols TEXT[] DEFAULT '{}',
    categories TEXT[] DEFAULT '{}',
    markets TEXT[] DEFAULT '{}',
    sentiment FLOAT,
    importance SMALLINT DEFAULT 2,
    llm_summary TEXT,
    llm_impact TEXT,
    llm_key_factors TEXT[] DEFAULT '{}',
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_news_source_id
ON news_items(source, source_id)
WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_news_published ON news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_symbols ON news_items USING GIN(symbols);
CREATE INDEX IF NOT EXISTS idx_news_markets ON news_items USING GIN(markets);
CREATE INDEX IF NOT EXISTS idx_news_unprocessed ON news_items(id) WHERE processed = FALSE;

CREATE TABLE IF NOT EXISTS market_events (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    event_type VARCHAR(60) NOT NULL,
    event_date DATE NOT NULL,
    event_time TIMESTAMPTZ,
    symbols TEXT[] DEFAULT '{}',
    markets TEXT[] DEFAULT '{}',
    description TEXT,
    importance SMALLINT DEFAULT 3,
    source VARCHAR(60),
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_date ON market_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON market_events(event_type);

CREATE TABLE IF NOT EXISTS event_impact_records (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT REFERENCES market_events(id) ON DELETE CASCADE,
    symbol VARCHAR(30) NOT NULL,
    asset_type VARCHAR(10) NOT NULL,
    t_minus_5d_ret FLOAT,
    t_minus_1d_ret FLOAT,
    t_plus_1d_ret FLOAT,
    t_plus_3d_ret FLOAT,
    t_plus_5d_ret FLOAT,
    t_plus_20d_ret FLOAT,
    vol_ratio_1d FLOAT,
    max_drawdown FLOAT,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, symbol)
);

CREATE TABLE IF NOT EXISTS watchlist_items (
    id BIGSERIAL PRIMARY KEY,
    symbol VARCHAR(30) NOT NULL,
    asset_type VARCHAR(10) NOT NULL,
    name VARCHAR(100),
    sort_order INTEGER DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(symbol, asset_type)
);

CREATE TABLE IF NOT EXISTS llm_analysis_cache (
    id BIGSERIAL PRIMARY KEY,
    cache_key VARCHAR(128) UNIQUE NOT NULL,
    task_type VARCHAR(50),
    model VARCHAR(80),
    output JSONB NOT NULL,
    tokens_used INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_cache_expires ON llm_analysis_cache(expires_at);

CREATE TABLE IF NOT EXISTS market_snapshot_daily (
    trade_date DATE NOT NULL,
    market VARCHAR(10) NOT NULL,
    symbol VARCHAR(30) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trade_date, market, symbol)
);

CREATE INDEX IF NOT EXISTS idx_market_snapshot_daily_market_date
ON market_snapshot_daily(market, trade_date DESC);

CREATE TABLE IF NOT EXISTS backtest_cache (
    cache_key VARCHAR(128) PRIMARY KEY,
    category VARCHAR(40) NOT NULL,
    request_payload JSONB NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backtest_cache_expires_at
ON backtest_cache(expires_at);

-- 数据保留策略（ohlcv_daily 保留5年）
SELECT add_retention_policy('ohlcv_daily', INTERVAL '5 years', if_not_exists => TRUE);
