"""Contract tests for /api/v1/backtest/lab request validation."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_backtest_lab_returns_422_for_invalid_page_size() -> None:
    payload = {
        "market": "us",
        "strategy_name": "ma_cross",
        "parameters": {"fast": 5, "slow": 20},
        "start_date": "2024-01-01",
        "end_date": "2024-12-31",
        "initial_capital": 1_000_000,
        "symbol_limit": 200,
        "page": 1,
        "page_size": 20,  # Contract requires page_size == 50.
    }
    resp = client.post("/api/v1/backtest/lab", json=payload)

    assert resp.status_code == 422
    detail = resp.json().get("detail", [])
    assert isinstance(detail, list)
    assert any("page_size" in str(item.get("loc", [])) for item in detail)


def test_backtest_lab_returns_422_for_invalid_strategy_name() -> None:
    payload = {
        "market": "us",
        "strategy_name": "unsupported_strategy",
        "parameters": {},
        "start_date": "2024-01-01",
        "end_date": "2024-12-31",
        "initial_capital": 1_000_000,
        "symbol_limit": 200,
        "page": 1,
        "page_size": 50,
    }
    resp = client.post("/api/v1/backtest/lab", json=payload)

    assert resp.status_code == 422
    detail = resp.json().get("detail", [])
    assert isinstance(detail, list)
    assert any("strategy_name" in str(item.get("loc", [])) for item in detail)
