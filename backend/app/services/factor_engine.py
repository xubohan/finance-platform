"""Factor scoring engine for stock ranking.

The engine combines four economic factors into a weighted total score:
- value: cheaper valuation (lower PE) gets higher score
- growth: faster earnings growth gets higher score
- momentum: stronger recent return gets higher score
- quality: better profitability (ROE) gets higher score
"""

from __future__ import annotations

import pandas as pd


def normalize_factor(series: pd.Series, reverse: bool = False) -> pd.Series:
    """Scale factor values to [0, 100].

    Args:
        series: raw factor values.
        reverse: when True, lower raw value is better (e.g. PE).
    """
    s = pd.to_numeric(series, errors="coerce")
    min_v = s.min(skipna=True)
    max_v = s.max(skipna=True)

    if pd.isna(min_v) or pd.isna(max_v) or max_v == min_v:
        return pd.Series([50.0] * len(s), index=s.index)

    scaled = (s - min_v) / (max_v - min_v) * 100
    if reverse:
        scaled = 100 - scaled

    return scaled.fillna(0)


def score_factors(df: pd.DataFrame, weights: dict, top_n: int = 50) -> pd.DataFrame:
    """Compute weighted multi-factor ranking.

    Required columns:
      symbol, name, pe_ttm, profit_yoy, momentum_20d, roe

    Weights must sum to 100 across keys: value, growth, momentum, quality.
    """
    required = ["symbol", "name", "pe_ttm", "profit_yoy", "momentum_20d", "roe"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")

    total_weight = sum(float(weights.get(k, 0)) for k in ["value", "growth", "momentum", "quality"])
    if round(total_weight, 6) != 100.0:
        raise ValueError("weights must sum to 100")

    out = df.copy()

    # Value factor economics: lower PE implies cheaper valuation.
    out["value_score"] = normalize_factor(out["pe_ttm"], reverse=True)
    # Growth factor economics: higher profit growth implies stronger expansion.
    out["growth_score"] = normalize_factor(out["profit_yoy"])
    # Momentum factor economics: trend persistence over recent windows.
    out["momentum_score"] = normalize_factor(out["momentum_20d"])
    # Quality factor economics: higher ROE implies better capital efficiency.
    out["quality_score"] = normalize_factor(out["roe"])

    out["total_score"] = (
        out["value_score"] * float(weights.get("value", 0)) / 100
        + out["growth_score"] * float(weights.get("growth", 0)) / 100
        + out["momentum_score"] * float(weights.get("momentum", 0)) / 100
        + out["quality_score"] * float(weights.get("quality", 0)) / 100
    )

    out = out.sort_values("total_score", ascending=False).head(top_n).reset_index(drop=True)
    return out[
        [
            "symbol",
            "name",
            "total_score",
            "value_score",
            "growth_score",
            "momentum_score",
            "quality_score",
            "pe_ttm",
            "roe",
            "profit_yoy",
            "momentum_20d",
        ]
    ]
