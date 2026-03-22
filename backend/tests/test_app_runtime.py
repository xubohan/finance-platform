"""Tests for runtime router surface defaults."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.observability import increment_counter, runtime_observability


def _paths(app) -> set[str]:
    return {route.path for route in app.routes}


def test_app_defaults_to_core_market_workspace_routes() -> None:
    app = create_app(Settings(enable_research_apis=False, enable_ai_api=False))
    paths = _paths(app)

    assert "/api/v1/market/search" in paths
    assert "/api/v1/market/{symbol}/summary" in paths
    assert "/api/v1/market/quotes" in paths
    assert "/api/v1/backtest/run" in paths
    assert "/health" in paths
    assert "/api/v1/health" in paths
    assert "/api/v1/system/observability" in paths
    assert "/api/v1/system/cache-maintenance" in paths
    assert "/api/v1/system/cache-maintenance/cleanup" in paths
    assert "/api/v1/factors/score" not in paths
    assert "/api/v1/screener/run" not in paths
    assert "/api/v1/ai/run" not in paths


def test_app_can_enable_research_and_ai_routes_explicitly() -> None:
    app = create_app(Settings(enable_research_apis=True, enable_ai_api=True))
    paths = _paths(app)

    assert "/api/v1/factors/score" in paths
    assert "/api/v1/screener/run" in paths
    assert "/api/v1/ai/run" in paths


def test_observability_endpoint_reports_http_and_market_counters(monkeypatch) -> None:
    runtime_observability.reset()
    app = create_app(Settings(enable_research_apis=False, enable_ai_api=False, observability_slow_request_ms=5))
    client = TestClient(app)

    from app.api import market as market_api

    monkeypatch.setattr(market_api, "detect_provider", lambda symbol: ("crypto", "coingecko"))
    monkeypatch.setattr(
        market_api,
        "fetch_crypto_realtime_price",
        lambda symbols: {"BTC": {"price": 68000.5, "change_pct_24h": 2.31}},
    )

    quote_resp = client.get("/api/v1/market/BTC/quote")
    assert quote_resp.status_code == 200

    missing_resp = client.get("/api/v1/does-not-exist")
    assert missing_resp.status_code == 404

    increment_counter("market.sync.success")
    increment_counter("market.sync.failure")
    increment_counter("market.movers.stock.success", 2)
    increment_counter("market.movers.crypto.failure")

    obs_resp = client.get("/api/v1/system/observability")
    assert obs_resp.status_code == 200

    payload = obs_resp.json()["data"]
    assert payload["http"]["total_requests"] == 2
    assert payload["http"]["slow_request_threshold_ms"] == 5
    assert payload["http"]["status_buckets"]["2xx"] == 1
    assert payload["http"]["status_buckets"]["4xx"] == 1
    assert payload["counters"]["market.quote.crypto.live_success"] == 1
    assert payload["market"]["quotes"]["crypto"]["live_hit_rate_pct"] == 100.0
    assert payload["market"]["sync"]["success_rate_pct"] == 50.0
    assert payload["market"]["movers"]["stock"]["success_rate_pct"] == 100.0
    assert payload["market"]["movers"]["crypto"]["success_rate_pct"] == 0.0
    assert any(item["path"] == "/api/v1/market/{symbol}/quote" for item in payload["http"]["routes"])
    assert any(item["path"] == "/api/v1/does-not-exist" and item["status_code"] == 404 for item in payload["http"]["failing_routes"])


def test_cache_maintenance_endpoints_return_summary_and_cleanup(monkeypatch) -> None:
    app = create_app(Settings(enable_research_apis=False, enable_ai_api=False, snapshot_daily_retention_days=30))
    client = TestClient(app)

    from app.api import system as system_api

    async def _mock_summary(db, snapshot_retention_days: int):
        assert snapshot_retention_days == 30
        return {
            "market_snapshot_daily": {
                "retention_days": 30,
                "cutoff_date": "2026-02-12",
                "total_rows": 100,
                "purgeable_rows": 5,
                "oldest_trade_date": "2026-01-01",
                "newest_trade_date": "2026-03-13",
            },
            "backtest_cache": {
                "total_rows": 20,
                "expired_rows": 4,
                "oldest_created_at": "2026-03-13T00:00:00+00:00",
                "newest_created_at": "2026-03-14T00:00:00+00:00",
                "oldest_expires_at": "2026-03-13T12:00:00+00:00",
                "newest_expires_at": "2026-03-14T12:00:00+00:00",
            },
        }

    async def _mock_cleanup(db, snapshot_retention_days: int, dry_run: bool):
        assert snapshot_retention_days == 30
        return {
            "dry_run": dry_run,
            "deleted_rows": {
                "market_snapshot_daily": 5,
                "backtest_cache": 4,
            },
            "before": {
                "market_snapshot_daily": {"purgeable_rows": 5},
                "backtest_cache": {"expired_rows": 4},
            },
            "after": {
                "market_snapshot_daily": {"purgeable_rows": 0},
                "backtest_cache": {"expired_rows": 0},
            },
        }

    monkeypatch.setattr(system_api, "read_cache_maintenance_summary", _mock_summary)
    monkeypatch.setattr(system_api, "cleanup_research_cache_tables", _mock_cleanup)

    summary_resp = client.get("/api/v1/system/cache-maintenance")
    assert summary_resp.status_code == 200
    summary_payload = summary_resp.json()
    assert summary_payload["meta"]["snapshot_retention_days"] == 30
    assert summary_payload["data"]["market_snapshot_daily"]["purgeable_rows"] == 5
    assert summary_payload["data"]["backtest_cache"]["expired_rows"] == 4

    cleanup_resp = client.post("/api/v1/system/cache-maintenance/cleanup?dry_run=false")
    assert cleanup_resp.status_code == 200
    cleanup_payload = cleanup_resp.json()
    assert cleanup_payload["data"]["dry_run"] is False
    assert cleanup_payload["data"]["deleted_rows"]["market_snapshot_daily"] == 5
    assert cleanup_payload["data"]["deleted_rows"]["backtest_cache"] == 4
