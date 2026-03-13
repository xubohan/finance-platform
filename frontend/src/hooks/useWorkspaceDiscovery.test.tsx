import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkspaceDiscovery } from './useWorkspaceDiscovery'

const mockSearchAssets = vi.fn()
const mockGetTopMovers = vi.fn()
const mockGetHealth = vi.fn()

vi.mock('../api/market', () => ({
  searchAssets: (...args: unknown[]) => mockSearchAssets(...args),
  getTopMovers: (...args: unknown[]) => mockGetTopMovers(...args),
}))

vi.mock('../api/system', () => ({
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}))

describe('useWorkspaceDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchAssets.mockResolvedValue({ data: [], meta: {} })
    mockGetTopMovers.mockResolvedValue({ data: [], meta: {} })
    mockGetHealth.mockResolvedValue({ status: 'ok', research_apis: false, ai_api: false })
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
