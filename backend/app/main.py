"""FastAPI application entrypoint."""

from fastapi import FastAPI

from app.api.ai_analysis import router as ai_router
from app.api.backtest import router as backtest_router
from app.api.factors import router as factors_router
from app.api.indicators import router as indicators_router
from app.api.market import router as market_router
from app.api.screener import router as screener_router

app = FastAPI(title="Finance Terminal API", version="0.1.0")
app.include_router(market_router, prefix="/api/v1/market", tags=["market"])
app.include_router(indicators_router, prefix="/api/v1/indicators", tags=["indicators"])
app.include_router(screener_router, prefix="/api/v1/screener", tags=["screener"])
app.include_router(factors_router, prefix="/api/v1/factors", tags=["factors"])
app.include_router(backtest_router, prefix="/api/v1/backtest", tags=["backtest"])
app.include_router(ai_router, prefix="/api/v1/ai", tags=["ai"])


@app.get("/health")
async def health() -> dict:
    """Liveness probe endpoint."""
    return {"status": "ok"}
