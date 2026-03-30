"""Event impact statistics and heuristic prediction helpers."""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from typing import Any

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ohlcv_store import load_ohlcv_window
from app.services.openbb_adapter import detect_provider


class EventImpactEngine:
    """Aggregate historical event impact records and derive simple predictions."""

    async def historical_context(
        self,
        db: AsyncSession,
        *,
        event_type: str,
        symbols: list[str],
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        rows_result = await db.execute(
            text(
                """
                SELECT e.id AS event_id, e.title, e.event_date, r.symbol, r.t_plus_1d_ret, r.t_plus_5d_ret, r.t_plus_20d_ret, r.vol_ratio_1d
                FROM market_events e
                LEFT JOIN event_impact_records r ON r.event_id = e.id
                WHERE e.event_type = :event_type
                  AND (:symbols_empty OR r.symbol = ANY(:symbols))
                ORDER BY e.event_date DESC
                LIMIT 300
                """
            ),
            {"event_type": event_type, "symbols": symbols or [""], "symbols_empty": len(symbols) == 0},
        )
        rows = rows_result.mappings().all()

        grouped: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        for row in rows:
            symbol = row["symbol"]
            if not symbol:
                continue
            for metric in ("t_plus_1d_ret", "t_plus_5d_ret", "t_plus_20d_ret", "vol_ratio_1d"):
                value = row[metric]
                if value is not None:
                    grouped[symbol][metric].append(float(value))

        predictions: list[dict[str, Any]] = []
        for symbol in symbols:
            bucket = grouped.get(symbol, {})
            rets_5d = bucket.get("t_plus_5d_ret", [])
            rets_20d = bucket.get("t_plus_20d_ret", [])
            vol = bucket.get("vol_ratio_1d", [])
            sample_size = len(rets_5d)
            positive = sum(1 for item in rets_5d if item > 0)
            win_rate = round(positive / sample_size, 4) if sample_size else 0.5
            avg_5d = round(sum(rets_5d) / sample_size, 4) if sample_size else 0.0
            avg_20d = round(sum(rets_20d) / len(rets_20d), 4) if rets_20d else 0.0
            predictions.append(
                {
                    "symbol": symbol,
                    "historical_win_rate_5d": win_rate,
                    "historical_avg_return_5d": avg_5d,
                    "historical_avg_return_20d": avg_20d,
                    "sample_size": sample_size,
                    "avg_vol_ratio_1d": round(sum(vol) / len(vol), 4) if vol else None,
                }
            )

        context = {
            "similar_events_found": len({row["event_id"] for row in rows}),
            "event_type": event_type,
            "sample_description": f"同类事件样本 {len({row['event_id'] for row in rows})} 条",
        }
        return context, predictions

    async def backfill_event_impacts(
        self,
        db: AsyncSession,
        *,
        event_id: int,
        event_date: Any,
        symbols: list[str],
    ) -> int:
        normalized_date = pd.Timestamp(event_date).tz_localize("UTC") if pd.Timestamp(event_date).tzinfo is None else pd.Timestamp(event_date).tz_convert("UTC")
        stored = 0
        for symbol in [item.upper() for item in symbols if item]:
            asset_type, _ = detect_provider(symbol)
            start_date = (normalized_date - pd.Timedelta(days=12)).date().isoformat()
            end_date = (normalized_date + pd.Timedelta(days=45)).date().isoformat()
            frame, _ = await load_ohlcv_window(
                db=db,
                symbol=symbol,
                asset_type=asset_type,
                start_date=start_date,
                end_date=end_date,
                interval="1d",
                prefer_local=False,
                sync_if_missing=True,
            )
            if frame.empty or len(frame) < 8:
                continue
            working = frame.copy()
            working["time"] = pd.to_datetime(working["time"], utc=True)
            working = working.sort_values("time").reset_index(drop=True)
            event_idx = working.index[working["time"] >= normalized_date]
            if len(event_idx) == 0:
                event_pos = len(working) - 1
            else:
                event_pos = int(event_idx[0])
            event_close = float(working.loc[event_pos, "close"])
            prev_5 = max(event_pos - 5, 0)
            prev_1 = max(event_pos - 1, 0)
            plus_1 = min(event_pos + 1, len(working) - 1)
            plus_3 = min(event_pos + 3, len(working) - 1)
            plus_5 = min(event_pos + 5, len(working) - 1)
            plus_20 = min(event_pos + 20, len(working) - 1)
            trailing_volume = working.loc[max(event_pos - 5, 0) : max(event_pos - 1, 0), "volume"]
            avg_volume = float(trailing_volume.mean()) if not trailing_volume.empty else None
            max_drawdown = None
            post_close = working.loc[event_pos:plus_20, "close"]
            if not post_close.empty:
                rolling_peak = post_close.cummax()
                drawdowns = (post_close / rolling_peak) - 1
                max_drawdown = float(drawdowns.min())

            payload = {
                "event_id": event_id,
                "symbol": symbol,
                "asset_type": asset_type,
                "t_minus_5d_ret": round((event_close / float(working.loc[prev_5, "close"]) - 1) * 100, 4) if prev_5 < event_pos else None,
                "t_minus_1d_ret": round((event_close / float(working.loc[prev_1, "close"]) - 1) * 100, 4) if prev_1 < event_pos else None,
                "t_plus_1d_ret": round((float(working.loc[plus_1, "close"]) / event_close - 1) * 100, 4) if plus_1 > event_pos else None,
                "t_plus_3d_ret": round((float(working.loc[plus_3, "close"]) / event_close - 1) * 100, 4) if plus_3 > event_pos else None,
                "t_plus_5d_ret": round((float(working.loc[plus_5, "close"]) / event_close - 1) * 100, 4) if plus_5 > event_pos else None,
                "t_plus_20d_ret": round((float(working.loc[plus_20, "close"]) / event_close - 1) * 100, 4) if plus_20 > event_pos else None,
                "vol_ratio_1d": round(float(working.loc[event_pos, "volume"]) / avg_volume, 4) if avg_volume and avg_volume > 0 else None,
                "max_drawdown": round(max_drawdown * 100, 4) if max_drawdown is not None else None,
            }
            await db.execute(
                text(
                    """
                    INSERT INTO event_impact_records(
                        event_id, symbol, asset_type, t_minus_5d_ret, t_minus_1d_ret,
                        t_plus_1d_ret, t_plus_3d_ret, t_plus_5d_ret, t_plus_20d_ret, vol_ratio_1d, max_drawdown, calculated_at
                    ) VALUES (
                        :event_id, :symbol, :asset_type, :t_minus_5d_ret, :t_minus_1d_ret,
                        :t_plus_1d_ret, :t_plus_3d_ret, :t_plus_5d_ret, :t_plus_20d_ret, :vol_ratio_1d, :max_drawdown, NOW()
                    )
                    ON CONFLICT (event_id, symbol) DO UPDATE SET
                        asset_type = EXCLUDED.asset_type,
                        t_minus_5d_ret = EXCLUDED.t_minus_5d_ret,
                        t_minus_1d_ret = EXCLUDED.t_minus_1d_ret,
                        t_plus_1d_ret = EXCLUDED.t_plus_1d_ret,
                        t_plus_3d_ret = EXCLUDED.t_plus_3d_ret,
                        t_plus_5d_ret = EXCLUDED.t_plus_5d_ret,
                        t_plus_20d_ret = EXCLUDED.t_plus_20d_ret,
                        vol_ratio_1d = EXCLUDED.vol_ratio_1d,
                        max_drawdown = EXCLUDED.max_drawdown,
                        calculated_at = NOW()
                    """
                ),
                payload,
            )
            stored += 1
        await db.commit()
        return stored
