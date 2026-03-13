"""Tests for runtime router surface defaults."""

from __future__ import annotations

from app.config import Settings
from app.main import create_app


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
    assert "/api/v1/factors/score" not in paths
    assert "/api/v1/screener/run" not in paths
    assert "/api/v1/ai/run" not in paths


def test_app_can_enable_research_and_ai_routes_explicitly() -> None:
    app = create_app(Settings(enable_research_apis=True, enable_ai_api=True))
    paths = _paths(app)

    assert "/api/v1/factors/score" in paths
    assert "/api/v1/screener/run" in paths
    assert "/api/v1/ai/run" in paths
