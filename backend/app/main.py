"""FastAPI application entrypoint."""

from __future__ import annotations

import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, settings
from app.services.observability import configure_runtime_observability, record_http_request


def create_app(runtime_settings: Settings | None = None) -> FastAPI:
    """Create FastAPI app with optional research and AI surfaces."""
    cfg = runtime_settings or settings
    configure_runtime_observability(slow_request_threshold_ms=cfg.observability_slow_request_ms)
    application = FastAPI(title="Market Workspace API", version="0.2.0")
    application.state.settings = cfg
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

    @application.middleware("http")
    async def track_runtime_observability(request, call_next):
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            route = request.scope.get("route")
            route_path = getattr(route, "path", None) or request.url.path
            record_http_request(
                method=request.method,
                path=route_path,
                status_code=status_code,
                duration_ms=(time.perf_counter() - started) * 1000,
            )

    from app.api.backtest import router as backtest_router
    from app.api.market import router as market_router
    from app.api.system import router as system_router

    application.include_router(market_router, prefix="/api/v1/market", tags=["market"])
    application.include_router(backtest_router, prefix="/api/v1/backtest", tags=["backtest"])
    application.include_router(system_router, prefix="/api/v1/system", tags=["system"])

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
