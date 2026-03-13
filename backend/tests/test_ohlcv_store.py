"""Tests for local OHLCV coverage heuristics."""

from __future__ import annotations

import pandas as pd

from app.services.ohlcv_store import has_full_local_coverage


def test_has_full_local_coverage_rejects_large_internal_gap_for_stocks() -> None:
    frame = pd.DataFrame(
        {
            "time": pd.to_datetime(
                [
                    "2024-01-01",
                    "2024-01-02",
                    "2024-01-03",
                    "2024-02-01",
                    "2024-02-02",
                ],
                utc=True,
            ),
            "open": [10, 11, 12, 13, 14],
            "high": [11, 12, 13, 14, 15],
            "low": [9, 10, 11, 12, 13],
            "close": [10, 11, 12, 13, 14],
            "volume": [100, 100, 100, 100, 100],
        }
    )

    assert has_full_local_coverage(frame, "2024-01-01", "2024-02-02", "stock") is False


def test_has_full_local_coverage_accepts_dense_crypto_daily_series() -> None:
    frame = pd.DataFrame(
        {
            "time": pd.date_range(start="2024-01-01", end="2024-01-10", freq="D", tz="UTC"),
            "open": [100 + idx for idx in range(10)],
            "high": [101 + idx for idx in range(10)],
            "low": [99 + idx for idx in range(10)],
            "close": [100 + idx for idx in range(10)],
            "volume": [1000] * 10,
        }
    )

    assert has_full_local_coverage(frame, "2024-01-01", "2024-01-10", "crypto") is True
