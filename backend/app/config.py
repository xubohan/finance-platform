"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    """Parse relaxed boolean environment values."""
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class Settings:
    """Runtime settings used by backend services."""

    api_host: str = os.getenv("API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("API_PORT", "8000"))
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://finuser:finpass@db:5432/finterminal",
    )
    redis_url: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    celery_broker_url: str = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/1")
    celery_result_backend: str = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/2")
    enable_research_apis: bool = _env_bool("ENABLE_RESEARCH_APIS", False)
    enable_ai_api: bool = _env_bool("ENABLE_AI_API", False)
    enable_llm_analysis: bool = _env_bool("ENABLE_LLM_ANALYSIS", True)
    enable_news_fetch: bool = _env_bool("ENABLE_NEWS_FETCH", True)
    enable_cn_data: bool = _env_bool("ENABLE_CN_DATA", True)
    initialize_runtime_schema: bool = _env_bool("INITIALIZE_RUNTIME_SCHEMA", False)
    observability_slow_request_ms: int = int(os.getenv("OBSERVABILITY_SLOW_REQUEST_MS", "1500"))
    provider_health_cache_ttl_sec: int = int(os.getenv("PROVIDER_HEALTH_CACHE_TTL_SEC", "15"))
    snapshot_daily_retention_days: int = int(os.getenv("SNAPSHOT_DAILY_RETENTION_DAYS", "45"))
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "https://api.openai.com")
    llm_model: str = os.getenv("LLM_MODEL", "gpt-5.3-codex")
    llm_api_style: str = os.getenv("LLM_API_STYLE", "responses")
    llm_endpoint_path: str = os.getenv("LLM_ENDPOINT_PATH", "/v1/responses")
    llm_reasoning_effort: str = os.getenv("LLM_REASONING_EFFORT", "medium")
    llm_text_verbosity: str = os.getenv("LLM_TEXT_VERBOSITY", "low")
    llm_max_tokens: int = int(os.getenv("LLM_MAX_TOKENS", "1000"))
    llm_timeout_sec: int = int(os.getenv("LLM_TIMEOUT_SEC", "60"))
    quote_provider_timeout_sec: int = int(os.getenv("QUOTE_PROVIDER_TIMEOUT_SEC", "6"))
    quote_provider_user_agent: str = os.getenv("QUOTE_PROVIDER_USER_AGENT", "finance-platform/0.1")
    crypto_quote_provider_order: str = os.getenv(
        "CRYPTO_QUOTE_PROVIDER_ORDER",
        "binance,kraken,coinbase,coingecko",
    )
    stock_quote_provider_order: str = os.getenv(
        "STOCK_QUOTE_PROVIDER_ORDER",
        "finnhub,twelvedata,tencent,yfinance,alphavantage",
    )
    stock_ohlcv_provider_order: str = os.getenv(
        "STOCK_OHLCV_PROVIDER_ORDER",
        "twelvedata,yfinance,stooq",
    )
    crypto_binance_base_url: str = os.getenv("CRYPTO_BINANCE_BASE_URL", "https://api.binance.com")
    crypto_kraken_base_url: str = os.getenv("CRYPTO_KRAKEN_BASE_URL", "https://api.kraken.com")
    crypto_coinbase_base_url: str = os.getenv("CRYPTO_COINBASE_BASE_URL", "https://api.exchange.coinbase.com")
    crypto_coingecko_base_url: str = os.getenv("CRYPTO_COINGECKO_BASE_URL", "https://api.coingecko.com")
    finnhub_api_key: str = os.getenv("FINNHUB_API_KEY", "")
    finnhub_base_url: str = os.getenv("FINNHUB_BASE_URL", "https://finnhub.io/api/v1")
    twelvedata_api_key: str = os.getenv("TWELVEDATA_API_KEY", "")
    twelvedata_base_url: str = os.getenv("TWELVEDATA_BASE_URL", "https://api.twelvedata.com")
    tencent_quote_base_url: str = os.getenv("TENCENT_QUOTE_BASE_URL", "https://qt.gtimg.cn/q=")
    alphavantage_api_key: str = os.getenv("ALPHAVANTAGE_API_KEY", "")
    alphavantage_base_url: str = os.getenv("ALPHAVANTAGE_BASE_URL", "https://www.alphavantage.co/query")
    alphavantage_entitlement: str = os.getenv("ALPHAVANTAGE_ENTITLEMENT", "")
    news_fetch_interval_min: int = int(os.getenv("NEWS_FETCH_INTERVAL_MIN", "15"))
    news_llm_batch_size: int = int(os.getenv("NEWS_LLM_BATCH_SIZE", "10"))
    cryptopanic_api_key: str = os.getenv("CRYPTOPANIC_API_KEY", "")
    tushare_token: str = os.getenv("TUSHARE_TOKEN", "")
    # Legacy env keys kept for backward compatibility in mixed deployments.
    binance_base_url: str = os.getenv("BINANCE_BASE_URL", "https://api.binance.com")
    kraken_base_url: str = os.getenv("KRAKEN_BASE_URL", "https://api.kraken.com")
    coinbase_base_url: str = os.getenv("COINBASE_BASE_URL", "https://api.exchange.coinbase.com")
    coingecko_base_url: str = os.getenv("COINGECKO_BASE_URL", "https://api.coingecko.com")


settings = Settings()
