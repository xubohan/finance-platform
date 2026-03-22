"""Provider health checks for nightly monitoring."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import time
from typing import Any, Callable

import pandas as pd

from app.services.openbb_adapter import (
    fetch_crypto_realtime_price,
    fetch_ohlcv_with_meta,
    fetch_stock_snapshot_with_meta,
    fetch_stock_symbols_with_meta,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _elapsed_ms(started: float) -> int:
    return max(0, int((time.perf_counter() - started) * 1000))


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat()


def _check_wrapper(name: str, runner: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    started = time.perf_counter()
    checked_at = _iso(_utc_now())
    try:
        payload = runner()
        payload.setdefault("status", "ok")
        payload.setdefault("details", {})
    except Exception as exc:  # pragma: no cover - exercised via tests with monkeypatch
        payload = {
            "status": "error",
            "details": {
                "error": str(exc),
            },
        }

    payload["name"] = name
    payload["checked_at"] = checked_at
    payload["latency_ms"] = _elapsed_ms(started)
    return payload


def _stock_snapshot_check() -> dict[str, Any]:
    rows, meta = fetch_stock_snapshot_with_meta(
        market="us",
        limit=20,
        force_refresh=True,
        allow_stale=False,
    )
    count = len(rows)
    if count <= 0:
        return {"status": "error", "details": {"rows": 0, "source": meta.get("source")}}
    status = "ok" if meta.get("source") == "live" and not bool(meta.get("stale")) else "degraded"
    return {
        "status": status,
        "details": {
            "market": "us",
            "rows": count,
            "source": meta.get("source"),
            "stale": bool(meta.get("stale")),
            "as_of": meta.get("as_of"),
            "cache_age_sec": meta.get("cache_age_sec"),
        },
    }


def _stock_symbols_check() -> dict[str, Any]:
    rows, meta = fetch_stock_symbols_with_meta(
        market="us",
        limit=20,
        force_refresh=True,
        allow_stale=False,
    )
    count = len(rows)
    if count <= 0:
        return {"status": "error", "details": {"rows": 0, "source": meta.get("source")}}
    status = "ok" if meta.get("source") == "live" and not bool(meta.get("stale")) else "degraded"
    return {
        "status": status,
        "details": {
            "market": "us",
            "rows": count,
            "source": meta.get("source"),
            "stale": bool(meta.get("stale")),
            "as_of": meta.get("as_of"),
            "cache_age_sec": meta.get("cache_age_sec"),
        },
    }


def _stock_ohlcv_check(now_utc: datetime) -> dict[str, Any]:
    end_date = now_utc.date().isoformat()
    start_date = (now_utc.date() - timedelta(days=45)).isoformat()
    frame, meta = fetch_ohlcv_with_meta("AAPL", start_date, end_date, "1d")
    count = len(frame)
    if count <= 0:
        return {"status": "error", "details": {"rows": 0, "fetch_source": meta.get("fetch_source")}}
    fetch_source = meta.get("fetch_source")
    status = "ok" if fetch_source == "openbb" else "degraded"
    return {
        "status": status,
        "details": {
            "symbol": "AAPL",
            "rows": count,
            "provider": meta.get("provider"),
            "fetch_source": fetch_source,
            "as_of": meta.get("as_of"),
        },
    }


def _crypto_quote_check() -> dict[str, Any]:
    rows = fetch_crypto_realtime_price(["BTC"])
    item = rows.get("BTC") if isinstance(rows, dict) else None
    if not isinstance(item, dict) or item.get("price") in (None, 0):
        return {"status": "error", "details": {"symbol": "BTC", "price": None}}
    return {
        "status": "ok",
        "details": {
            "symbol": "BTC",
            "provider": "coingecko",
            "price": item.get("price"),
            "change_pct_24h": item.get("change_pct_24h"),
        },
    }


def _crypto_ohlcv_check(now_utc: datetime) -> dict[str, Any]:
    end_date = now_utc.date().isoformat()
    start_date = (now_utc.date() - timedelta(days=45)).isoformat()
    frame, meta = fetch_ohlcv_with_meta("BTC", start_date, end_date, "1d")
    count = len(frame)
    if count <= 0:
        return {"status": "error", "details": {"rows": 0, "fetch_source": meta.get("fetch_source")}}
    fetch_source = meta.get("fetch_source")
    status = "ok" if fetch_source == "openbb" else "degraded"
    return {
        "status": status,
        "details": {
            "symbol": "BTC",
            "rows": count,
            "provider": meta.get("provider"),
            "fetch_source": fetch_source,
            "as_of": meta.get("as_of"),
        },
    }


def run_provider_health_check(now_utc: datetime | None = None) -> dict[str, Any]:
    if now_utc is None:
        now_utc = _utc_now()

    checks = [
        _check_wrapper("stock_snapshot_us", _stock_snapshot_check),
        _check_wrapper("stock_symbols_us", _stock_symbols_check),
        _check_wrapper("stock_ohlcv_aapl", lambda: _stock_ohlcv_check(now_utc)),
        _check_wrapper("crypto_quote_btc", _crypto_quote_check),
        _check_wrapper("crypto_ohlcv_btc", lambda: _crypto_ohlcv_check(now_utc)),
    ]

    ok_checks = sum(1 for item in checks if item["status"] == "ok")
    degraded_checks = sum(1 for item in checks if item["status"] == "degraded")
    error_checks = sum(1 for item in checks if item["status"] == "error")

    overall_status = "ok"
    if error_checks > 0:
        overall_status = "error"
    elif degraded_checks > 0:
        overall_status = "degraded"

    return {
        "summary": {
            "status": overall_status,
            "total_checks": len(checks),
            "ok_checks": ok_checks,
            "degraded_checks": degraded_checks,
            "error_checks": error_checks,
            "generated_at": _iso(now_utc),
        },
        "checks": checks,
    }
