import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceDiscovery } from './useWorkspaceDiscovery'

const mockSearchAssets = vi.fn()
const mockGetTopMovers = vi.fn()
const mockGetHealth = vi.fn()
const mockGetObservability = vi.fn()
const mockGetCacheMaintenance = vi.fn()

vi.mock('../api/market', () => ({
  searchAssets: (...args: unknown[]) => mockSearchAssets(...args),
  getTopMovers: (...args: unknown[]) => mockGetTopMovers(...args),
}))

vi.mock('../api/system', () => ({
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
  getObservability: (...args: unknown[]) => mockGetObservability(...args),
  getCacheMaintenance: (...args: unknown[]) => mockGetCacheMaintenance(...args),
}))

describe('useWorkspaceDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchAssets.mockResolvedValue({ data: [], meta: {} })
    mockGetTopMovers.mockResolvedValue({ data: [], meta: {} })
    mockGetHealth.mockResolvedValue({ status: 'ok', research_apis: false, ai_api: false })
    mockGetObservability.mockResolvedValue({
      uptime_sec: 120,
      http: { total_requests: 4, status_buckets: { '2xx': 4, '4xx': 0, '5xx': 0 }, routes: [], failing_routes: [] },
      counters: { 'market.quote.crypto.live_success': 1 },
    })
    mockGetCacheMaintenance.mockResolvedValue({
      market_snapshot_daily: { total_rows: 20, purgeable_rows: 2, retention_days: 45 },
      backtest_cache: { total_rows: 5, expired_rows: 1 },
    })
  })

  it('loads movers and health state on mount', async () => {
    mockGetTopMovers
      .mockResolvedValueOnce({ data: [{ symbol: 'AAPL', change_pct: 1.2, latest: 100 }], meta: { source: 'cache', stale: false, as_of: '2026-03-13T00:00:00+00:00', cache_age_sec: 60 } })
      .mockResolvedValueOnce({ data: [{ symbol: 'BTC', change_pct: 2.3, latest: 70000 }], meta: { source: 'live', stale: false, as_of: null, cache_age_sec: null } })

    const { result } = renderHook(() => useWorkspaceDiscovery('', 'all'))

    await waitFor(() => {
      expect(result.current.stockMovers).toHaveLength(1)
      expect(result.current.cryptoMovers).toHaveLength(1)
      expect(result.current.stockMoversMeta?.source).toBe('cache')
      expect(result.current.cryptoMoversMeta?.source).toBe('live')
      expect(result.current.health?.status).toBe('ok')
      expect(result.current.observability?.http?.total_requests).toBe(4)
      expect(result.current.cacheMaintenance?.market_snapshot_daily?.purgeable_rows).toBe(2)
    })
  })

  it('runs search when deferred input is present and can clear search results', async () => {
    mockSearchAssets.mockResolvedValue({
      data: [{ symbol: 'AAPL', name: 'Apple Inc.', asset_type: 'stock', market: 'US' }],
      meta: {},
    })

    const { result } = renderHook(() => useWorkspaceDiscovery('AAPL', 'stock'))

    await waitFor(() => {
      expect(result.current.searchResults).toHaveLength(1)
    })

    act(() => {
      result.current.clearSearchResults()
    })

    await waitFor(() => {
      expect(result.current.searchResults).toEqual([])
      expect(result.current.searchError).toBeNull()
    })
  })
})
