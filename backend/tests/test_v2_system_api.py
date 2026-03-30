"""Contract tests for /api/v2/system routes."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.config import Settings

from tests._v2_testutils import QueueAsyncSession, make_client


def _patch_runtime_samples(
    monkeypatch: pytest.MonkeyPatch,
    system_v2,
    *,
    stock: dict | None = None,
    crypto: dict | None = None,
    datasets: dict | None = None,
) -> None:
    monkeypatch.setattr(
        system_v2,
        "read_stock_quote_sample",
        lambda: stock
        or {
            "symbol": "AAPL",
            "asset_type": "stock",
            "status": "ok",
            "error": None,
            "source": "live",
            "provider": "tencent",
            "fetch_source": "tencent",
            "stale": False,
            "as_of": "2026-03-30T14:14:19+00:00",
            "price": 222.15,
            "change_pct_24h": 1.24,
        },
    )
    monkeypatch.setattr(
        system_v2,
        "read_crypto_quote_sample",
        lambda: crypto
        or {
            "symbol": "BTC",
            "asset_type": "crypto",
            "status": "ok",
            "error": None,
            "source": "live",
            "provider": "binance",
            "fetch_source": "binance",
            "stale": False,
            "as_of": "2026-03-30T14:15:33.011000+00:00",
            "price": 84500.12,
            "change_pct_24h": 2.51,
        },
    )

    async def _mock_read_dataset_status(_db) -> dict:
        return datasets or {
            "status": "ok",
            "news_items_total": 128,
            "news_items_last_24h": 22,
            "latest_news_at": "2026-03-30T14:10:00+00:00",
            "market_events_total": 43,
            "upcoming_events_30d": 9,
            "latest_event_at": "2026-03-30T08:00:00+00:00",
            "watchlist_items_total": 7,
        }

    monkeypatch.setattr(system_v2, "read_dataset_status", _mock_read_dataset_status)


def test_v2_system_health_reflects_feature_flags() -> None:
    client = make_client(
        settings=Settings(
            enable_research_apis=False,
            enable_ai_api=False,
            enable_llm_analysis=True,
            enable_news_fetch=False,
            enable_cn_data=True,
            initialize_runtime_schema=False,
        )
    )

    resp = client.get("/api/v2/system/health")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "ok"
    assert payload["version"] == "v2"
    assert payload["features"] == {
        "research_apis": False,
        "ai_api": False,
        "llm_analysis": True,
        "news_fetch": False,
        "cn_data": True,
    }


def test_v2_system_data_status_uses_provider_report(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import system as system_v2

    system_v2._clear_data_status_cache()
    _patch_runtime_samples(monkeypatch, system_v2)
    monkeypatch.setattr(
        system_v2,
        "run_provider_health_check",
        lambda *args, **kwargs: {
            "summary": {"status": "degraded", "total_checks": 5},
            "checks": [{"name": "stock_snapshot_us", "status": "degraded"}],
        },
    )
    client = make_client(
        settings=Settings(
            enable_research_apis=False,
            enable_ai_api=False,
            enable_llm_analysis=True,
            enable_news_fetch=True,
            enable_cn_data=False,
            initialize_runtime_schema=False,
        ),
        db_session=QueueAsyncSession([]),
    )

    resp = client.get("/api/v2/system/data-status")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["data"]["provider_health"]["summary"]["status"] == "degraded"
    assert payload["data"]["llm"] == {
        "configured": False,
        "model": "gpt-5.3-codex",
        "api_style": "responses",
        "base_url": "https://api.openai.com",
        "endpoint_path": "/v1/responses",
        "reasoning_effort": "medium",
    }
    assert payload["data"]["feature_flags"] == {
        "enable_news_fetch": True,
        "enable_cn_data": False,
        "enable_llm_analysis": True,
    }
    assert payload["data"]["stock_quote_aapl"] == {
        "symbol": "AAPL",
        "asset_type": "stock",
        "status": "ok",
        "error": None,
        "source": "live",
        "provider": "tencent",
        "fetch_source": "tencent",
        "stale": False,
        "as_of": "2026-03-30T14:14:19+00:00",
        "price": 222.15,
        "change_pct_24h": 1.24,
    }
    assert payload["data"]["crypto_quote_btc"] == {
        "symbol": "BTC",
        "asset_type": "crypto",
        "status": "ok",
        "error": None,
        "source": "live",
        "provider": "binance",
        "fetch_source": "binance",
        "stale": False,
        "as_of": "2026-03-30T14:15:33.011000+00:00",
        "price": 84500.12,
        "change_pct_24h": 2.51,
    }
    assert payload["data"]["datasets"] == {
        "status": "ok",
        "news_items_total": 128,
        "news_items_last_24h": 22,
        "latest_news_at": "2026-03-30T14:10:00+00:00",
        "market_events_total": 43,
        "upcoming_events_30d": 9,
        "latest_event_at": "2026-03-30T08:00:00+00:00",
        "watchlist_items_total": 7,
    }
    assert "generated_at" in payload["meta"]
    assert payload["meta"]["served_from_cache"] is False
    assert payload["meta"]["cache_ttl_sec"] == 15


def test_v2_system_data_status_reports_custom_llm_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import system as system_v2

    system_v2._clear_data_status_cache()
    _patch_runtime_samples(monkeypatch, system_v2)
    monkeypatch.setattr(system_v2, "run_provider_health_check", lambda *args, **kwargs: {"summary": {"status": "ok"}, "checks": []})
    client = make_client(
        settings=Settings(
            enable_research_apis=False,
            enable_ai_api=False,
            enable_llm_analysis=True,
            llm_api_key="sk-test",
            llm_model="gpt-5.3-codex",
            llm_api_style="chat_completions",
            llm_base_url="https://llm.example.com/api",
            llm_endpoint_path="/custom/chat",
            llm_reasoning_effort="high",
            initialize_runtime_schema=False,
        ),
        db_session=QueueAsyncSession([]),
    )

    resp = client.get("/api/v2/system/data-status")
    assert resp.status_code == 200
    llm = resp.json()["data"]["llm"]
    assert llm["configured"] is True
    assert llm["model"] == "gpt-5.3-codex"
    assert llm["api_style"] == "chat_completions"
    assert llm["base_url"] == "https://llm.example.com/api"
    assert llm["endpoint_path"] == "/custom/chat"
    assert llm["reasoning_effort"] == "high"


def test_v2_system_data_status_serves_cached_payload_within_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import system as system_v2

    system_v2._clear_data_status_cache()
    calls = {"count": 0}
    runtime_calls = {"count": 0}

    def _mock_report(*args, **kwargs):
        calls["count"] += 1
        return {"summary": {"status": "ok", "call": calls["count"]}, "checks": []}

    def _mock_stock() -> dict:
        runtime_calls["count"] += 1
        return {
            "symbol": "AAPL",
            "asset_type": "stock",
            "status": "ok",
            "error": None,
            "source": "live",
            "provider": "tencent",
            "fetch_source": "tencent",
            "stale": False,
            "as_of": "2026-03-30T14:14:19+00:00",
            "price": 220 + runtime_calls["count"],
            "change_pct_24h": 1.24,
        }

    async def _mock_datasets(_db) -> dict:
        return {
            "status": "ok",
            "news_items_total": 100 + runtime_calls["count"],
            "news_items_last_24h": 20,
            "latest_news_at": "2026-03-30T14:10:00+00:00",
            "market_events_total": 40,
            "upcoming_events_30d": 8,
            "latest_event_at": "2026-03-30T08:00:00+00:00",
            "watchlist_items_total": 7,
        }

    monkeypatch.setattr(system_v2, "run_provider_health_check", _mock_report)
    monkeypatch.setattr(system_v2, "read_stock_quote_sample", _mock_stock)
    monkeypatch.setattr(
        system_v2,
        "read_crypto_quote_sample",
        lambda: {
            "symbol": "BTC",
            "asset_type": "crypto",
            "status": "ok",
            "error": None,
            "source": "live",
            "provider": "binance",
            "fetch_source": "binance",
            "stale": False,
            "as_of": "2026-03-30T14:15:33.011000+00:00",
            "price": 84500.12,
            "change_pct_24h": 2.51,
        },
    )
    monkeypatch.setattr(system_v2, "read_dataset_status", _mock_datasets)
    client = make_client(
        settings=Settings(
            enable_research_apis=False,
            enable_ai_api=False,
            enable_llm_analysis=True,
            initialize_runtime_schema=False,
            provider_health_cache_ttl_sec=60,
        ),
        db_session=QueueAsyncSession([]),
    )

    first = client.get("/api/v2/system/data-status")
    second = client.get("/api/v2/system/data-status")

    assert first.status_code == 200
    assert second.status_code == 200
    assert calls["count"] == 1
    assert runtime_calls["count"] == 1
    assert first.json()["meta"]["served_from_cache"] is False
    assert second.json()["meta"]["served_from_cache"] is True
    assert second.json()["data"]["provider_health"]["summary"]["call"] == 1
    assert first.json()["data"]["stock_quote_aapl"]["price"] == 221
    assert second.json()["data"]["stock_quote_aapl"]["price"] == 221


def test_v2_system_data_status_force_refresh_bypasses_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import system as system_v2

    system_v2._clear_data_status_cache()
    calls = {"count": 0}
    runtime_calls = {"count": 0}

    def _mock_report(*args, **kwargs):
        calls["count"] += 1
        return {"summary": {"status": "ok", "call": calls["count"]}, "checks": []}

    def _mock_stock() -> dict:
        runtime_calls["count"] += 1
        return {
            "symbol": "AAPL",
            "asset_type": "stock",
            "status": "ok",
            "error": None,
            "source": "live",
            "provider": "tencent",
            "fetch_source": "tencent",
            "stale": False,
            "as_of": "2026-03-30T14:14:19+00:00",
            "price": 220 + runtime_calls["count"],
            "change_pct_24h": 1.24,
        }

    async def _mock_datasets(_db) -> dict:
        return {
            "status": "ok",
            "news_items_total": 100 + runtime_calls["count"],
            "news_items_last_24h": 20,
            "latest_news_at": "2026-03-30T14:10:00+00:00",
            "market_events_total": 40,
            "upcoming_events_30d": 8,
            "latest_event_at": "2026-03-30T08:00:00+00:00",
            "watchlist_items_total": 7,
        }

    monkeypatch.setattr(system_v2, "run_provider_health_check", _mock_report)
    monkeypatch.setattr(system_v2, "read_stock_quote_sample", _mock_stock)
    monkeypatch.setattr(
        system_v2,
        "read_crypto_quote_sample",
        lambda: {
            "symbol": "BTC",
            "asset_type": "crypto",
            "status": "ok",
            "error": None,
            "source": "live",
            "provider": "binance",
            "fetch_source": "binance",
            "stale": False,
            "as_of": "2026-03-30T14:15:33.011000+00:00",
            "price": 84500.12,
            "change_pct_24h": 2.51,
        },
    )
    monkeypatch.setattr(system_v2, "read_dataset_status", _mock_datasets)
    client = make_client(
        settings=Settings(
            enable_research_apis=False,
            enable_ai_api=False,
            enable_llm_analysis=True,
            initialize_runtime_schema=False,
            provider_health_cache_ttl_sec=60,
        ),
        db_session=QueueAsyncSession([]),
    )

    first = client.get("/api/v2/system/data-status")
    second = client.get("/api/v2/system/data-status", params={"force_refresh": "true"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert calls["count"] == 2
    assert runtime_calls["count"] == 2
    assert first.json()["meta"]["served_from_cache"] is False
    assert second.json()["meta"]["served_from_cache"] is False
    assert second.json()["data"]["provider_health"]["summary"]["call"] == 2
    assert first.json()["data"]["stock_quote_aapl"]["price"] == 221
    assert second.json()["data"]["stock_quote_aapl"]["price"] == 222


def test_v2_system_data_status_force_refresh_propagates_to_provider_health(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import system as system_v2

    system_v2._clear_data_status_cache()
    calls: list[bool] = []

    def _mock_report(*args, **kwargs):
        calls.append(bool(kwargs.get("force_refresh")))
        return {"summary": {"status": "ok", "force_refresh": calls[-1]}, "checks": []}

    _patch_runtime_samples(monkeypatch, system_v2)
    monkeypatch.setattr(system_v2, "run_provider_health_check", _mock_report)
    client = make_client(
        settings=Settings(
            enable_research_apis=False,
            enable_ai_api=False,
            enable_llm_analysis=True,
            initialize_runtime_schema=False,
            provider_health_cache_ttl_sec=60,
        ),
        db_session=QueueAsyncSession([]),
    )

    first = client.get("/api/v2/system/data-status")
    second = client.get("/api/v2/system/data-status", params={"force_refresh": "true"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert calls == [False, True]
    assert first.json()["data"]["provider_health"]["summary"]["force_refresh"] is False
    assert second.json()["data"]["provider_health"]["summary"]["force_refresh"] is True


def test_v2_system_observability_delegates_to_v1(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import system as system_v2

    async def _mock_get_observability(route_limit: int, failing_limit: int, counter_limit: int):
        assert route_limit == 9
        assert failing_limit == 4
        assert counter_limit == 11
        return {
            "data": {"http": {"total_requests": 3}},
            "meta": {"generated_at": datetime.now(timezone.utc).isoformat()},
        }

    monkeypatch.setattr(system_v2.system_v1, "get_observability", _mock_get_observability)
    client = make_client()

    resp = client.get("/api/v2/system/observability", params={"route_limit": 9, "failing_limit": 4, "counter_limit": 11})
    assert resp.status_code == 200
    assert resp.json()["data"]["http"]["total_requests"] == 3


def test_v2_system_cache_maintenance_delegates_to_v1(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.api.v2 import system as system_v2

    async def _mock_get_cache_maintenance(request, db):
        return {"data": {"market_snapshot_daily": {"total_rows": 10}}, "meta": {"generated_at": "2026-03-25T00:00:00+00:00"}}

    async def _mock_cleanup_cache_maintenance(request, dry_run: bool, db):
        return {"data": {"dry_run": dry_run, "deleted_rows": {"backtest_cache": 2}}, "meta": {"generated_at": "2026-03-25T00:00:00+00:00"}}

    monkeypatch.setattr(system_v2.system_v1, "get_cache_maintenance", _mock_get_cache_maintenance)
    monkeypatch.setattr(system_v2.system_v1, "cleanup_cache_maintenance", _mock_cleanup_cache_maintenance)
    client = make_client(db_session=QueueAsyncSession([]))

    summary_resp = client.get("/api/v2/system/cache-maintenance")
    assert summary_resp.status_code == 200
    assert summary_resp.json()["data"]["market_snapshot_daily"]["total_rows"] == 10

    cleanup_resp = client.post("/api/v2/system/cache-maintenance/cleanup?dry_run=false")
    assert cleanup_resp.status_code == 200
    assert cleanup_resp.json()["data"]["dry_run"] is False
    assert cleanup_resp.json()["data"]["deleted_rows"]["backtest_cache"] == 2
