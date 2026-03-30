"""Shared helpers for v2 API contract tests."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from fastapi.testclient import TestClient

from app.config import Settings
from app.database import get_db
from app.main import create_app


class FakeResult:
    """Minimal async SQLAlchemy-like result wrapper for API tests."""

    def __init__(self, *, rows: list[dict[str, Any]] | None = None, scalar: Any = None) -> None:
        self._rows = rows or []
        self._scalar = scalar

    def mappings(self) -> "FakeResult":
        return self

    def all(self) -> list[dict[str, Any]]:
        return list(self._rows)

    def one(self) -> dict[str, Any]:
        if not self._rows:
            raise AssertionError("FakeResult.one() called without rows")
        return self._rows[0]

    def first(self) -> dict[str, Any] | None:
        return self._rows[0] if self._rows else None

    def scalar_one(self) -> Any:
        if self._scalar is not None:
            return self._scalar
        if self._rows and "total" in self._rows[0]:
            return self._rows[0]["total"]
        return 0


class QueueAsyncSession:
    """Queue-based async session that returns predefined execute results."""

    def __init__(self, results: list[FakeResult]) -> None:
        self._results = list(results)
        self.calls: list[dict[str, Any]] = []
        self.commits = 0

    async def execute(self, statement: Any, params: dict[str, Any] | None = None) -> FakeResult:
        self.calls.append({"sql": str(statement), "params": dict(params or {})})
        if not self._results:
            raise AssertionError("Unexpected execute call: no fake results left")
        return self._results.pop(0)

    async def commit(self) -> None:
        self.commits += 1


def make_client(*, db_session: QueueAsyncSession | None = None, settings: Settings | None = None) -> TestClient:
    """Create test client with optional DB dependency override."""
    app = create_app(
        settings
        or Settings(
            enable_research_apis=False,
            enable_ai_api=False,
            initialize_runtime_schema=False,
        )
    )
    if db_session is not None:

        async def _override_get_db() -> AsyncGenerator[QueueAsyncSession, None]:
            yield db_session

        app.dependency_overrides[get_db] = _override_get_db
    return TestClient(app)
