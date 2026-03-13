import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAssetMarketData } from './useAssetMarketData'

const mockGetMarketSummary = vi.fn()
const mockGetKline = vi.fn()
const mockSyncHistory = vi.fn()
const mockToCandles = vi.fn()

vi.mock('../api/market', () => ({
  getMarketSummary: (...args: unknown[]) => mockGetMarketSummary(...args),
  getKline: (...args: unknown[]) => mockGetKline(...args),
  syncHistory: (...args: unknown[]) => mockSyncHistory(...args),
  toCandles: (...args: unknown[]) => mockToCandles(...args),
}))

describe('useAssetMarketData', () => {
  const stockAsset = { symbol: 'AAPL', name: 'Apple Inc.', asset_type: 'stock' as const, market: 'US' }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMarketSummary.mockResolvedValue({
      data: {
        symbol: 'AAPL',
        asset_type: 'stock',
        quote: { symbol: 'AAPL', asset_type: 'stock', price: 100, change_pct_24h: 1.2, as_of: '2026-03-11T00:00:00+00:00' },
        history_status: { symbol: 'AAPL', asset_type: 'stock', local_rows: 100, local_start: '2026-01-01T00:00:00+00:00', local_end: '2026-03-11T00:00:00+00:00', has_data: true },
      },
      meta: { quote: { source: 'live', as_of: '2026-03-11T00:00:00+00:00' } },
    })
    mockGetKline.mockResolvedValue({
      data: [{ time: '2026-03-10T00:00:00+00:00', open: 99, high: 101, low: 98, close: 100, volume: 1000 }],
      meta: { source: 'live', as_of: '2026-03-11T00:00:00+00:00' },
    })
    mockSyncHistory.mockResolvedValue({
      data: { symbol: 'AAPL', asset_type: 'stock', local_rows: 120, local_start: '2026-01-01T00:00:00+00:00', local_end: '2026-03-11T00:00:00+00:00' },
      meta: {},
    })
    mockToCandles.mockReturnValue([{ time: '2026-03-10', open: 99, high: 101, low: 98, close: 100 }])
  })

  it('loads quote, kline and history status for the selected asset', async () => {
    const { result } = renderHook(() =>
      useAssetMarketData({
        selectedAsset: stockAsset,
        period: '1d',
        chartStartDate: '2026-03-01',
        chartEndDate: '2026-03-11',
      }),
    )

    await waitFor(() => {
      expect(result.current.quote?.symbol).toBe('AAPL')
      expect(result.current.historyStatus?.local_rows).toBe(100)
      expect(result.current.candles).toHaveLength(1)
      expect(result.current.quoteSource).toBe('live')
      expect(result.current.klineSource).toBe('live')
    })
  })

  it('surfaces local sources when quote and kline hit persisted data', async () => {
    mockGetMarketSummary.mockResolvedValueOnce({
      data: {
        symbol: 'AAPL',
        asset_type: 'stock',
        quote: { symbol: 'AAPL', asset_type: 'stock', price: 100, change_pct_24h: 1.2, as_of: '2026-03-11T00:00:00+00:00' },
        history_status: { symbol: 'AAPL', asset_type: 'stock', local_rows: 100, local_start: '2026-01-01T00:00:00+00:00', local_end: '2026-03-11T00:00:00+00:00', has_data: true },
      },
      meta: { quote: { source: 'local', fetch_source: 'database', as_of: '2026-03-11T00:00:00+00:00' } },
    })
    mockGetKline.mockResolvedValueOnce({
      data: [{ time: '2026-03-10T00:00:00+00:00', open: 99, high: 101, low: 98, close: 100, volume: 1000 }],
      meta: { source: 'local', fetch_source: 'database', as_of: '2026-03-11T00:00:00+00:00' },
    })

    const { result } = renderHook(() =>
      useAssetMarketData({
        selectedAsset: stockAsset,
        period: '1d',
        chartStartDate: '2026-03-01',
        chartEndDate: '2026-03-11',
      }),
    )

    await waitFor(() => {
      expect(result.current.quoteSource).toBe('local')
      expect(result.current.klineSource).toBe('local')
    })
  })

  it('rejects invalid chart date ranges without calling the kline api', async () => {
    const { result } = renderHook(() =>
      useAssetMarketData({
        selectedAsset: stockAsset,
        period: '1d',
        chartStartDate: '2026-03-11',
        chartEndDate: '2026-03-01',
      }),
    )

    await waitFor(() => {
      expect(result.current.marketError).toBe('K 线开始日期必须早于结束日期')
    })
    expect(mockGetKline).not.toHaveBeenCalled()
  })

  it('preserves quote errors even when kline loads successfully', async () => {
    mockGetMarketSummary.mockResolvedValueOnce({
      data: {
        symbol: 'AAPL',
        asset_type: 'stock',
        quote: null,
        history_status: { symbol: 'AAPL', asset_type: 'stock', local_rows: 100, local_start: '2026-01-01T00:00:00+00:00', local_end: '2026-03-11T00:00:00+00:00', has_data: true },
      },
      meta: { quote: null, quote_error: '报价暂时不可用' },
    })

    const { result } = renderHook(() =>
      useAssetMarketData({
        selectedAsset: stockAsset,
        period: '1d',
        chartStartDate: '2026-03-01',
        chartEndDate: '2026-03-11',
      }),
    )

    await waitFor(() => {
      expect(result.current.marketError).toBe('报价暂时不可用')
      expect(result.current.candles).toHaveLength(1)
    })
  })

  it('ignores stale sync results after switching assets', async () => {
    let resolveSync: ((value: unknown) => void) | null = null
    mockSyncHistory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve
        }),
    )
    mockGetMarketSummary.mockImplementation(async (symbol: string) => ({
      data:
        symbol === 'BTC'
          ? {
              symbol: 'BTC',
              asset_type: 'crypto',
              quote: { symbol: 'BTC', asset_type: 'crypto', price: 70000, change_pct_24h: 2.5, as_of: '2026-03-11T00:00:00+00:00' },
              history_status: { symbol: 'BTC', asset_type: 'crypto', local_rows: 50, local_start: '2026-01-01T00:00:00+00:00', local_end: '2026-03-11T00:00:00+00:00', has_data: true },
            }
          : {
              symbol: 'AAPL',
              asset_type: 'stock',
              quote: { symbol: 'AAPL', asset_type: 'stock', price: 100, change_pct_24h: 1.2, as_of: '2026-03-11T00:00:00+00:00' },
              history_status: { symbol: 'AAPL', asset_type: 'stock', local_rows: 100, local_start: '2026-01-01T00:00:00+00:00', local_end: '2026-03-11T00:00:00+00:00', has_data: true },
            },
      meta: { quote: { source: symbol === 'BTC' ? 'cache' : 'local', as_of: '2026-03-11T00:00:00+00:00' } },
    }))

    const { result, rerender } = renderHook(
      ({ selectedAsset }) =>
        useAssetMarketData({
          selectedAsset,
          period: '1d',
          chartStartDate: '2026-03-01',
          chartEndDate: '2026-03-11',
        }),
      {
        initialProps: { selectedAsset: stockAsset },
      },
    )

    act(() => {
      void result.current.syncHistoryNow()
    })

    await waitFor(() => {
      expect(mockSyncHistory).toHaveBeenCalledTimes(1)
    })

    rerender({
      selectedAsset: { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto' as const, market: 'CRYPTO' },
    })

    await waitFor(() => {
      expect(result.current.historyStatus?.symbol).toBe('BTC')
    })

    resolveSync?.({
      data: { symbol: 'AAPL', asset_type: 'stock', local_rows: 999, local_start: '2026-01-01T00:00:00+00:00', local_end: '2026-03-11T00:00:00+00:00' },
      meta: {},
    })

    await waitFor(() => {
      expect(result.current.historyStatus?.symbol).toBe('BTC')
    })
  })
})
