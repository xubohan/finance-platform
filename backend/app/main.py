"""FastAPI application entrypoint."""

from fastapi import FastAPI

from app.api.market import router as market_router

app = FastAPI(title="Finance Terminal API", version="0.1.0")
app.include_router(market_router, prefix="/api/v1/market", tags=["market"])


@app.get("/health")
async def health() -> dict:
    """Liveness probe endpoint."""
    return {"status": "ok"}
