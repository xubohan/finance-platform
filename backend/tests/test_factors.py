"""Tests for factor scoring engine."""

from __future__ import annotations

import pandas as pd

from app.services.factor_engine import score_factors


def test_score_factors_basic() -> None:
    df = pd.DataFrame(
        [
            {
                "symbol": "AAA",
                "name": "Alpha",
                "pe_ttm": 30,
                "profit_yoy": 10,
                "momentum_20d": 5,
                "roe": 8,
            },
            {
                "symbol": "BBB",
                "name": "Beta",
                "pe_ttm": 12,
                "profit_yoy": 25,
                "momentum_20d": 8,
                "roe": 18,
            },
            {
                "symbol": "CCC",
                "name": "Gamma",
                "pe_ttm": 18,
                "profit_yoy": 15,
                "momentum_20d": 3,
                "roe": 11,
            },
        ]
    )

    out = score_factors(
        df,
        weights={"value": 25, "growth": 25, "momentum": 25, "quality": 25},
        top_n=3,
    )

    assert len(out) == 3
    assert set(["total_score", "value_score", "growth_score", "momentum_score", "quality_score"]).issubset(out.columns)
    # BBB should lead because it dominates all 4 factors in this synthetic sample.
    assert out.iloc[0]["symbol"] == "BBB"
