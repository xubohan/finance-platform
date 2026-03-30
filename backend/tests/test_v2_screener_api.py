"""Contract tests for /api/v2/screener wrapper routes."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from fastapi.testclient import TestClient

from app.api import screener as screener_v1
from app.config import Settings
from app.database import get_db
from app.main import create_app


class _DummyDbSession:
    pass


def _make_client(*, db_session: Any | None = None) -> TestClient:
    app = create_app(
        Settings(
            enable_research_apis=False,
            enable_ai_api=False,
            initialize_runtime_schema=False,
        )
    )
    if db_session is not None:

        async def _override_get_db() -> AsyncGenerator[Any, None]:
            yield db_session

        app.dependency_overrides[get_db] = _override_get_db
    return TestClient(app)


def test_v2_screener_routes_are_registered() -> None:
    app = create_app(
        Settings(
            enable_research_apis=False,
            enable_ai_api=False,
            initialize_runtime_schema=False,
        )
    )
    paths = {route.path for route in app.routes}
    assert "/api/v2/screener/symbols" in paths
    assert "/api/v2/screener/run" in paths


def test_v2_screener_symbols_delegates_to_v1(monkeypatch) -> None:
    called: dict[str, Any] = {}

    async def _mock_get_screener_symbols(
        market: str = "us",
        limit: int = 50,
        force_refresh: bool = True,
        allow_stale: bool = False,
    ) -> dict[str, Any]:
        called.update(
            {
                "market": market,
                "limit": limit,
                "force_refresh": force_refresh,
                "allow_stale": allow_stale,
            }
        )
        return {"data": [{"symbol": "AAPL"}], "meta": {"count": 1, "market": market}}

    monkeypatch.setattr(screener_v1, "get_screener_symbols", _mock_get_screener_symbols)
    client = _make_client()

    resp = client.get(
        "/api/v2/screener/symbols",
        params={"market": "cn", "limit": 25, "force_refresh": "false", "allow_stale": "true"},
    )

    assert resp.status_code == 200
    assert resp.json()["meta"]["market"] == "cn"
    assert called == {
        "market": "cn",
        "limit": 25,
        "force_refresh": False,
        "allow_stale": True,
    }


def test_v2_screener_run_delegates_to_v1(monkeypatch) -> None:
    called: dict[str, Any] = {}
    dummy_db = _DummyDbSession()

    async def _mock_run_screener(payload: screener_v1.ScreenerRequest, db: Any) -> dict[str, Any]:
        called["payload"] = payload
        called["db"] = db
        return {
            "data": [{"symbol": "AAPL", "roe": 0.2}],
            "meta": {"count": 1, "market": payload.market},
        }

    monkeypatch.setattr(screener_v1, "run_screener", _mock_run_screener)
    client = _make_client(db_session=dummy_db)

    resp = client.post(
        "/api/v2/screener/run",
        json={
            "market": "us",
            "symbol_limit": 100,
            "page": 1,
            "page_size": 50,
            "force_refresh": True,
            "allow_stale": False,
            "min_roe": 0.1,
        },
    )

    assert resp.status_code == 200
    assert resp.json()["meta"]["count"] == 1
    assert called["db"] is dummy_db
    assert isinstance(called["payload"], screener_v1.ScreenerRequest)
    assert called["payload"].market == "us"
    assert called["payload"].page_size == 50
