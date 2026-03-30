"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, settings
from app.services.observability import configure_runtime_observability, record_http_request
from app.services.runtime_schema import ensure_runtime_schema


def create_app(runtime_settings: Settings | None = None) -> FastAPI:
    """Create FastAPI app with optional research and AI surfaces."""
    cfg = runtime_settings or settings
    configure_runtime_observability(slow_request_threshold_ms=cfg.observability_slow_request_ms)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if cfg.initialize_runtime_schema:
            await ensure_runtime_schema()
        yield

    application = FastAPI(title="Finance Platform API", version="0.3.0", lifespan=lifespan)
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
            if request.url.path.startswith("/api/v1/"):
                response.headers["Deprecation"] = "true"
                response.headers["Sunset"] = "Wed, 31 Dec 2026 23:59:59 GMT"
                response.headers["Link"] = '</api/v2>; rel="successor-version"'
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
    from app.api.v2.analysis import router as analysis_v2_router
    from app.api.v2.backtest import router as backtest_v2_router
    from app.api.v2.events import router as events_v2_router
    from app.api.v2.market import router as market_v2_router
    from app.api.v2.news import router as news_v2_router
    from app.api.v2.screener import router as screener_v2_router
    from app.api.v2.system import router as system_v2_router
    from app.api.v2.watchlist import router as watchlist_v2_router

    application.include_router(market_router, prefix="/api/v1/market", tags=["market"])
    application.include_router(backtest_router, prefix="/api/v1/backtest", tags=["backtest"])
    application.include_router(system_router, prefix="/api/v1/system", tags=["system"])
    application.include_router(market_v2_router, prefix="/api/v2/market", tags=["market-v2"])
    application.include_router(news_v2_router, prefix="/api/v2/news", tags=["news-v2"])
    application.include_router(events_v2_router, prefix="/api/v2/events", tags=["events-v2"])
    application.include_router(analysis_v2_router, prefix="/api/v2/analysis", tags=["analysis-v2"])
    application.include_router(watchlist_v2_router, prefix="/api/v2/watchlist", tags=["watchlist-v2"])
    application.include_router(backtest_v2_router, prefix="/api/v2/backtest", tags=["backtest-v2"])
    application.include_router(screener_v2_router, prefix="/api/v2/screener", tags=["screener-v2"])
    application.include_router(system_v2_router, prefix="/api/v2/system", tags=["system-v2"])

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
