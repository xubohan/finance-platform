"""High-value tests for indicator engine outputs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from app.services.indicator_engine import calc_macd, calc_ma, calc_rsi


def _sample_df(rows: int = 80) -> pd.DataFrame:
    base = datetime(2024, 1, 1, tzinfo=timezone.utc)
    times = [base + timedelta(days=i) for i in range(rows)]

    close = np.linspace(100, 140, rows) + np.sin(np.linspace(0, 6, rows))
    high = close + 2
    low = close - 2
    open_ = close - 1
    volume = np.linspace(1000, 5000, rows)

    return pd.DataFrame(
        {
            "time": times,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    )


def test_ma_output_format() -> None:
    df = _sample_df()
    out = calc_ma(df, window=20)

    assert out
    assert set(out[0].keys()) == {"time", "value"}
    assert isinstance(out[0]["time"], int)
    assert isinstance(out[0]["value"], float)


def test_macd_components_present_and_aligned() -> None:
    df = _sample_df()
    out = calc_macd(df)

    assert set(out.keys()) == {"macd", "signal", "hist"}
    assert len(out["macd"]) == len(out["signal"]) == len(out["hist"])


def test_rsi_values_within_expected_bounds() -> None:
    df = _sample_df()
    out = calc_rsi(df, period=14)

    values = [p["value"] for p in out]
    assert values
    assert all(0 <= v <= 100 for v in values)
