"""FastAPI application entrypoint."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, settings


def create_app(runtime_settings: Settings | None = None) -> FastAPI:
    """Create FastAPI app with optional research and AI surfaces."""
    cfg = runtime_settings or settings
    application = FastAPI(title="Market Workspace API", version="0.2.0")
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost",
            "http://localhost:80",
            "http://127.0.0.1",
            "http://127.0.0.1:80",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.api.backtest import router as backtest_router
    from app.api.market import router as market_router

    application.include_router(market_router, prefix="/api/v1/market", tags=["market"])
    application.include_router(backtest_router, prefix="/api/v1/backtest", tags=["backtest"])

    if cfg.enable_research_apis:
        from app.api.factors import router as factors_router
        from app.api.indicators import router as indicators_router
        from app.api.screener import router as screener_router

        application.include_router(indicators_router, prefix="/api/v1/indicators", tags=["indicators"])
        application.include_router(screener_router, prefix="/api/v1/screener", tags=["screener"])
        application.include_router(factors_router, prefix="/api/v1/factors", tags=["factors"])

    if cfg.enable_ai_api:
        from app.api.ai_analysis import router as ai_router

        application.include_router(ai_router, prefix="/api/v1/ai", tags=["ai"])

    @application.get("/health")
    async def health() -> dict:
        """Liveness probe endpoint."""
        return {
            "status": "ok",
            "research_apis": cfg.enable_research_apis,
            "ai_api": cfg.enable_ai_api,
        }

    @application.get("/api/v1/health")
    async def health_api() -> dict:
        """API-scoped health endpoint for frontend clients using the API base path."""
        return {
            "status": "ok",
            "research_apis": cfg.enable_research_apis,
            "ai_api": cfg.enable_ai_api,
        }

    return application


app = create_app()
