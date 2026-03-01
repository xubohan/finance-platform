"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ai_analysis import router as ai_router
from app.api.backtest import router as backtest_router
from app.api.factors import router as factors_router
from app.api.indicators import router as indicators_router
from app.api.market import router as market_router
from app.api.screener import router as screener_router

app = FastAPI(title="Finance Terminal API", version="0.1.0")
app.add_middleware(
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
