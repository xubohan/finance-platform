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
    enable_research_apis: bool = _env_bool("ENABLE_RESEARCH_APIS", False)
    enable_ai_api: bool = _env_bool("ENABLE_AI_API", False)


settings = Settings()
