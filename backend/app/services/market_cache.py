"""Redis-backed cache helpers for market snapshot workloads."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from typing import Any

from redis import Redis

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

_client: Redis | None = None


def _redis() -> Redis | None:
    """Get lazy Redis client and gracefully degrade when unavailable."""
    global _client
    if _client is not None:
        return _client
    try:
        _client = Redis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
            retry_on_timeout=False,
        )
        _client.ping()
    except Exception:
        _client = None
    return _client


def cache_get_json(key: str) -> dict[str, Any] | None:
    """Read JSON payload from Redis."""
    client = _redis()
    if client is None:
        return None
    try:
        raw = client.get(key)
        if not raw:
            return None
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None
    return None


def cache_set_json(key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    """Write JSON payload to Redis with TTL."""
    client = _redis()
    if client is None:
        return
    try:
        client.setex(key, max(1, int(ttl_seconds)), json.dumps(payload, ensure_ascii=False))
    except Exception:
        return


def _is_weekday(now_utc: datetime) -> bool:
    return now_utc.weekday() < 5


def _is_us_session(now_utc: datetime) -> bool:
    # Approximate US market session in UTC (DST-aware precision is not required for cache TTL choice).
    minutes = now_utc.hour * 60 + now_utc.minute
    return 14 * 60 + 30 <= minutes <= 21 * 60


def _is_cn_session(now_utc: datetime) -> bool:
    # Approximate CN market sessions in UTC: 01:30-03:30 and 05:00-07:00.
    minutes = now_utc.hour * 60 + now_utc.minute
    return (1 * 60 + 30 <= minutes <= 3 * 60 + 30) or (5 * 60 <= minutes <= 7 * 60)


def is_active_session(market: str, now_utc: datetime | None = None) -> bool:
    """Return whether market is likely in active trading session."""
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)
    if not _is_weekday(now_utc):
        return False
    market_norm = market.lower().strip()
    if market_norm == "us":
        return _is_us_session(now_utc)
    if market_norm == "cn":
        return _is_cn_session(now_utc)
    if market_norm == "all":
        return _is_us_session(now_utc) or _is_cn_session(now_utc)
    return False


def snapshot_ttl_seconds(market: str) -> int:
    """TTL policy for snapshot-like data."""
    return 120 if is_active_session(market) else 900


def symbols_ttl_seconds(market: str) -> int:
    """TTL policy for symbol universe lists."""
    return 900 if is_active_session(market) else 6 * 3600


def total_ttl_seconds(market: str) -> int:
    """TTL policy for universe totals."""
    return 600 if is_active_session(market) else 12 * 3600

