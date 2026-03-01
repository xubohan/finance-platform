"""FastAPI application entrypoint."""

from fastapi import FastAPI

from app.api.factors import router as factors_router
from app.api.indicators import router as indicators_router
from app.api.market import router as market_router
from app.api.screener import router as screener_router

app = FastAPI(title="Finance Terminal API", version="0.1.0")
app.include_router(market_router, prefix="/api/v1/market", tags=["market"])
app.include_router(indicators_router, prefix="/api/v1/indicators", tags=["indicators"])
app.include_router(screener_router, prefix="/api/v1/screener", tags=["screener"])
app.include_router(factors_router, prefix="/api/v1/factors", tags=["factors"])


@app.get("/health")
async def health() -> dict:
    """Liveness probe endpoint."""
    return {"status": "ok"}
