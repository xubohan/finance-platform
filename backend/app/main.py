"""FastAPI application entrypoint."""

from fastapi import FastAPI

from app.api.indicators import router as indicators_router
from app.api.market import router as market_router

app = FastAPI(title="Finance Terminal API", version="0.1.0")
app.include_router(market_router, prefix="/api/v1/market", tags=["market"])
app.include_router(indicators_router, prefix="/api/v1/indicators", tags=["indicators"])


@app.get("/health")
async def health() -> dict:
    """Liveness probe endpoint."""
    return {"status": "ok"}
