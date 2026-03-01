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

-- 数据保留策略（ohlcv_daily 保留5年）
SELECT add_retention_policy('ohlcv_daily', INTERVAL '5 years', if_not_exists => TRUE);
