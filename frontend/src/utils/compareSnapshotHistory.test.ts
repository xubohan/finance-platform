import { describe, expect, it } from 'vitest'

import { parseCompareSnapshotHistory } from './compareSnapshotHistory'

describe('compareSnapshotHistory utils', () => {
  it('filters invalid compare history rows and normalizes valid rows', () => {
    const rows = parseCompareSnapshotHistory(
      JSON.stringify([
        {
          symbol: 'aapl',
          assetType: 'stock',
          strategyName: 'ma_cross',
          compareStrategyNames: ['buy_hold', 'ema_cross', 'ema_cross'],
          compareRankingMetric: 'total_return',
          fast: 5,
          slow: 20,
          rsiPeriod: 14,
          oversold: 30,
          overbought: 70,
          initialCapital: 100000,
          backtestStartDate: '2025-01-01',
          backtestEndDate: '2026-01-01',
          syncIfMissing: true,
          bestStrategyName: 'ema_cross',
          bestStrategyLabel: 'EMA Cross',
          currentRank: 2,
          storageSource: 'local',
          asOf: '2026-03-15T00:00:00+00:00',
          createdAt: '2026-03-15T01:00:00+00:00',
        },
        {
          symbol: '',
          assetType: 'broken',
          strategyName: 'bad',
          compareRankingMetric: 'broken',
          fast: -1,
          slow: 0,
          rsiPeriod: 1,
          oversold: 0,
          overbought: 0,
          initialCapital: 0,
          backtestStartDate: 'bad',
          backtestEndDate: 'bad',
          syncIfMissing: 'bad',
          bestStrategyName: 'bad',
          createdAt: '',
        },
      ]),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].symbol).toBe('AAPL')
    expect(rows[0].compareStrategyNames).toEqual(['buy_hold', 'ema_cross'])
    expect(rows[0].initialCapital).toBe(100000)
    expect(rows[0].backtestStartDate).toBe('2025-01-01')
    expect(rows[0].multiplier).toBe(30)
  })
})
