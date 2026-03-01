"""Technical indicator calculation engine.

Input:
  DataFrame with columns [time, open, high, low, close, volume]
Output:
  lightweight-charts compatible lists using unix seconds timestamps.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _to_list(time_s: pd.Series, val_s: pd.Series) -> list[dict]:
    """Convert pandas series to [{time, value}] format used by frontend charts."""
    out: list[dict] = []
    for t, v in zip(time_s, val_s):
        if pd.isna(v):
            continue
        out.append({"time": int(pd.Timestamp(t).timestamp()), "value": float(v)})
    return out


def calc_ma(df: pd.DataFrame, window: int = 20) -> list[dict]:
    """Simple moving average.

    Formula:
      MA_t = (C_t + C_{t-1} + ... + C_{t-window+1}) / window
    """
    ma = df["close"].rolling(window=window, min_periods=window).mean()
    return _to_list(df["time"], ma)


def calc_ema(df: pd.DataFrame, span: int = 20) -> list[dict]:
    """Exponential moving average.

    Formula:
      EMA_t = alpha * C_t + (1 - alpha) * EMA_{t-1}
      where alpha = 2 / (span + 1)
    """
    ema = df["close"].ewm(span=span, adjust=False).mean()
    return _to_list(df["time"], ema)


def calc_macd(
    df: pd.DataFrame,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> dict[str, list[dict]]:
    """MACD oscillator.

    Formula:
      DIF = EMA_fast(close) - EMA_slow(close)
      DEA = EMA_signal(DIF)
      HIST = DIF - DEA
    """
    ema_fast = df["close"].ewm(span=fast, adjust=False).mean()
    ema_slow = df["close"].ewm(span=slow, adjust=False).mean()
    dif = ema_fast - ema_slow
    dea = dif.ewm(span=signal, adjust=False).mean()
    hist = dif - dea

    return {
        "macd": _to_list(df["time"], dif),
        "signal": _to_list(df["time"], dea),
        "hist": _to_list(df["time"], hist),
    }


def calc_rsi(df: pd.DataFrame, period: int = 14) -> list[dict]:
    """Relative strength index.

    Formula:
      RSI = 100 - 100 / (1 + RS)
      RS = EMA(gain, period) / EMA(loss, period)
    """
    delta = df["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))

    # When average loss is zero (monotonic rise), RSI should be 100.
    rsi = rsi.mask((avg_loss == 0) & (avg_gain > 0), 100.0)
    # When average gain is zero (monotonic decline), RSI should be 0.
    rsi = rsi.mask((avg_gain == 0) & (avg_loss > 0), 0.0)
    # Perfectly flat prices map to neutral RSI.
    rsi = rsi.mask((avg_gain == 0) & (avg_loss == 0), 50.0)
    return _to_list(df["time"], rsi)


def calc_bollinger(df: pd.DataFrame, window: int = 20, std_mult: float = 2.0) -> dict[str, list[dict]]:
    """Bollinger bands.

    Formula:
      MID = MA(close, window)
      UPPER = MID + std_mult * STD(close, window)
      LOWER = MID - std_mult * STD(close, window)
    """
    mid = df["close"].rolling(window=window, min_periods=window).mean()
    std = df["close"].rolling(window=window, min_periods=window).std(ddof=0)

    upper = mid + std_mult * std
    lower = mid - std_mult * std

    return {
        "upper": _to_list(df["time"], upper),
        "middle": _to_list(df["time"], mid),
        "lower": _to_list(df["time"], lower),
    }


def calc_kdj(df: pd.DataFrame, period: int = 9, smooth_k: int = 3, smooth_d: int = 3) -> dict[str, list[dict]]:
    """KDJ oscillator.

    Formula:
      RSV = (C - LLV(L, period)) / (HHV(H, period) - LLV(L, period)) * 100
      K = EMA(RSV, smooth_k)
      D = EMA(K, smooth_d)
      J = 3*K - 2*D
    """
    low_n = df["low"].rolling(window=period, min_periods=period).min()
    high_n = df["high"].rolling(window=period, min_periods=period).max()

    rsv = (df["close"] - low_n) / (high_n - low_n).replace(0, np.nan) * 100
    k = rsv.ewm(alpha=1 / smooth_k, adjust=False).mean()
    d = k.ewm(alpha=1 / smooth_d, adjust=False).mean()
    j = 3 * k - 2 * d

    return {
        "k": _to_list(df["time"], k),
        "d": _to_list(df["time"], d),
        "j": _to_list(df["time"], j),
    }


def calculate_indicators(df: pd.DataFrame, names: list[str]) -> dict[str, object]:
    """Batch-calculate requested indicators by names."""
    name_map = {name.upper().strip() for name in names}
    result: dict[str, object] = {}

    if "MA" in name_map:
        result["MA"] = calc_ma(df)
    if "EMA" in name_map:
        result["EMA"] = calc_ema(df)
    if "MACD" in name_map:
        result["MACD"] = calc_macd(df)
    if "RSI" in name_map:
        result["RSI"] = calc_rsi(df)
    if "BOLL" in name_map or "BOLLINGER" in name_map:
        result["BOLL"] = calc_bollinger(df)
    if "KDJ" in name_map:
        result["KDJ"] = calc_kdj(df)

    return result
