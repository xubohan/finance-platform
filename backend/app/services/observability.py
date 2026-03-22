"""In-process runtime observability for HTTP and market events."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
import time
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _status_bucket(status_code: int) -> str:
    if 200 <= status_code < 300:
        return "2xx"
    if 300 <= status_code < 400:
        return "3xx"
    if 400 <= status_code < 500:
        return "4xx"
    if 500 <= status_code < 600:
        return "5xx"
    return "other"


@dataclass(slots=True)
class RouteMetric:
    total: int = 0
    total_duration_ms: float = 0.0
    max_duration_ms: float = 0.0
    last_duration_ms: float = 0.0
    slow_count: int = 0
    last_status: int = 0
    last_seen_at: str | None = None
    statuses: Counter[int] = field(default_factory=Counter)

    def record(self, status_code: int, duration_ms: float, *, slow_request_threshold_ms: int) -> None:
        self.total += 1
        self.total_duration_ms += duration_ms
        self.max_duration_ms = max(self.max_duration_ms, duration_ms)
        self.last_duration_ms = duration_ms
        if duration_ms >= slow_request_threshold_ms:
            self.slow_count += 1
        self.last_status = status_code
        self.last_seen_at = _utc_now_iso()
        self.statuses[status_code] += 1

    def snapshot(self, method: str, path: str) -> dict[str, Any]:
        avg_duration_ms = self.total_duration_ms / self.total if self.total else 0.0
        slow_rate_pct = (self.slow_count / self.total * 100) if self.total else 0.0
        return {
            "method": method,
            "path": path,
            "total": self.total,
            "avg_duration_ms": round(avg_duration_ms, 2),
            "max_duration_ms": round(self.max_duration_ms, 2),
            "last_duration_ms": round(self.last_duration_ms, 2),
            "slow_requests": self.slow_count,
            "slow_rate_pct": round(slow_rate_pct, 2),
            "last_status": self.last_status,
            "last_seen_at": self.last_seen_at,
            "status_breakdown": {str(code): count for code, count in sorted(self.statuses.items())},
        }


class RuntimeObservability:
    def __init__(self) -> None:
        self._lock = Lock()
        self._started_at = time.monotonic()
        self._route_metrics: dict[tuple[str, str], RouteMetric] = {}
        self._counters: Counter[str] = Counter()
        self._slow_request_threshold_ms = 1500

    def configure(self, *, slow_request_threshold_ms: int) -> None:
        with self._lock:
            self._slow_request_threshold_ms = max(1, int(slow_request_threshold_ms))

    def reset(self) -> None:
        with self._lock:
            self._started_at = time.monotonic()
            self._route_metrics.clear()
            self._counters.clear()

    def record_http_request(self, method: str, path: str, status_code: int, duration_ms: float) -> None:
        key = (method.upper(), path)
        with self._lock:
            metric = self._route_metrics.setdefault(key, RouteMetric())
            metric.record(status_code, duration_ms, slow_request_threshold_ms=self._slow_request_threshold_ms)

    def increment(self, name: str, amount: int = 1) -> None:
        if not name or amount <= 0:
            return
        with self._lock:
            self._counters[name] += amount

    @staticmethod
    def _rate(numerator: int, denominator: int) -> float:
        if denominator <= 0:
            return 0.0
        return round(numerator / denominator * 100, 2)

    def _market_summary(self, counters: dict[str, int]) -> dict[str, Any]:
        crypto_live = int(counters.get("market.quote.crypto.live_success", 0))
        crypto_cache = int(counters.get("market.quote.crypto.cache_fallback", 0))
        crypto_stale_cache = int(counters.get("market.quote.crypto.stale_cache_fallback", 0))
        crypto_ohlcv = int(counters.get("market.quote.crypto.ohlcv_fallback", 0))
        crypto_failures = int(counters.get("market.quote.crypto.upstream_failure", 0))
        crypto_total = crypto_live + crypto_cache + crypto_ohlcv + crypto_failures

        stock_local = int(counters.get("market.quote.stock.local_success", 0))
        stock_synced = int(counters.get("market.quote.stock.synced_success", 0))
        stock_live = int(counters.get("market.quote.stock.live_success", 0))
        stock_failures = int(counters.get("market.quote.stock.upstream_failure", 0))
        stock_total = stock_local + stock_synced + stock_live + stock_failures

        sync_success = int(counters.get("market.sync.success", 0))
        sync_failure = int(counters.get("market.sync.failure", 0))
        sync_total = sync_success + sync_failure

        stock_movers_success = int(counters.get("market.movers.stock.success", 0))
        stock_movers_failure = int(counters.get("market.movers.stock.failure", 0))
        stock_movers_total = stock_movers_success + stock_movers_failure

        crypto_movers_success = int(counters.get("market.movers.crypto.success", 0))
        crypto_movers_failure = int(counters.get("market.movers.crypto.failure", 0))
        crypto_movers_total = crypto_movers_success + crypto_movers_failure

        return {
            "quotes": {
                "crypto": {
                    "total": crypto_total,
                    "live_success": crypto_live,
                    "cache_fallback": crypto_cache,
                    "stale_cache_fallback": crypto_stale_cache,
                    "ohlcv_fallback": crypto_ohlcv,
                    "failures": crypto_failures,
                    "live_hit_rate_pct": self._rate(crypto_live, crypto_total),
                    "fallback_rate_pct": self._rate(crypto_cache + crypto_ohlcv, crypto_total),
                },
                "stock": {
                    "total": stock_total,
                    "local_success": stock_local,
                    "synced_success": stock_synced,
                    "live_success": stock_live,
                    "failures": stock_failures,
                    "local_hit_rate_pct": self._rate(stock_local, stock_total),
                    "sync_hit_rate_pct": self._rate(stock_synced, stock_total),
                },
            },
            "sync": {
                "total": sync_total,
                "success": sync_success,
                "failure": sync_failure,
                "success_rate_pct": self._rate(sync_success, sync_total),
            },
            "movers": {
                "stock": {
                    "total": stock_movers_total,
                    "success": stock_movers_success,
                    "failure": stock_movers_failure,
                    "success_rate_pct": self._rate(stock_movers_success, stock_movers_total),
                },
                "crypto": {
                    "total": crypto_movers_total,
                    "success": crypto_movers_success,
                    "failure": crypto_movers_failure,
                    "success_rate_pct": self._rate(crypto_movers_success, crypto_movers_total),
                },
            },
        }

    def snapshot(self, *, route_limit: int = 8, failing_limit: int = 6, counter_limit: int = 20) -> dict[str, Any]:
        with self._lock:
            route_rows = [
                metric.snapshot(method, path)
                for (method, path), metric in self._route_metrics.items()
            ]
            counters = dict(self._counters)
            uptime_sec = int(max(0.0, time.monotonic() - self._started_at))
            slow_request_threshold_ms = self._slow_request_threshold_ms

        status_totals: Counter[int] = Counter()
        status_buckets: Counter[str] = Counter()
        failing_routes: list[dict[str, Any]] = []

        for row in route_rows:
            for raw_status, count in row["status_breakdown"].items():
                status_code = int(raw_status)
                status_totals[status_code] += count
                status_buckets[_status_bucket(status_code)] += count
                if status_code >= 400:
                    failing_routes.append(
                        {
                            "method": row["method"],
                            "path": row["path"],
                            "status_code": status_code,
                            "count": count,
                            "last_seen_at": row["last_seen_at"],
                        }
                    )

        route_rows.sort(key=lambda item: (-item["total"], -item["avg_duration_ms"], item["path"]))
        failing_routes.sort(
            key=lambda item: (-item["count"], -item["status_code"], item["path"], item["method"])
        )
        slow_routes = sorted(
            [row for row in route_rows if row["slow_requests"] > 0],
            key=lambda item: (-item["slow_requests"], -item["max_duration_ms"], item["path"], item["method"]),
        )
        sorted_counters = sorted(counters.items(), key=lambda item: (-item[1], item[0]))

        return {
            "uptime_sec": uptime_sec,
            "http": {
                "total_requests": int(sum(status_totals.values())),
                "slow_request_threshold_ms": slow_request_threshold_ms,
                "status_buckets": {bucket: status_buckets.get(bucket, 0) for bucket in ("2xx", "3xx", "4xx", "5xx", "other")},
                "status_totals": {str(code): count for code, count in sorted(status_totals.items())},
                "routes": route_rows[:route_limit],
                "failing_routes": failing_routes[:failing_limit],
                "slow_routes": slow_routes[:failing_limit],
            },
            "market": self._market_summary(counters),
            "counters": {name: count for name, count in sorted_counters[:counter_limit]},
        }


runtime_observability = RuntimeObservability()


def record_http_request(method: str, path: str, status_code: int, duration_ms: float) -> None:
    runtime_observability.record_http_request(method=method, path=path, status_code=status_code, duration_ms=duration_ms)


def increment_counter(name: str, amount: int = 1) -> None:
    runtime_observability.increment(name=name, amount=amount)


def configure_runtime_observability(*, slow_request_threshold_ms: int) -> None:
    runtime_observability.configure(slow_request_threshold_ms=slow_request_threshold_ms)
