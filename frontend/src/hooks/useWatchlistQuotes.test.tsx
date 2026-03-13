import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWatchlistQuotes } from './useWatchlistQuotes'

const mockGetBatchQuotes = vi.fn()

vi.mock('../api/market', () => ({
  getBatchQuotes: (...args: unknown[]) => mockGetBatchQuotes(...args),
}))

describe('useWatchlistQuotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads quotes for watchlist assets', async () => {
    mockGetBatchQuotes.mockResolvedValue({
      data: [
        { symbol: 'AAPL', asset_type: 'stock', price: 100, change_pct_24h: 1.2, as_of: '2026-03-11T00:00:00+00:00', source: 'local' },
        { symbol: 'BTC', asset_type: 'crypto', price: 70000, change_pct_24h: 2.5, as_of: '2026-03-11T00:00:00+00:00', source: 'live' },
      ],
      meta: { count: 2, success_count: 2, failed_count: 0, failed_symbols: [] },
    })

    const { result } = renderHook(() =>
      useWatchlistQuotes([
        { symbol: 'AAPL', name: 'Apple', asset_type: 'stock', market: 'US' },
        { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' },
      ]),
    )

    await waitFor(() => {
      expect(result.current.rows).toHaveLength(2)
      expect(result.current.rows[0].price).toBe(100)
      expect(result.current.rows[1].price).toBe(70000)
      expect(result.current.error).toBeNull()
    })
  })

  it('keeps partial rows and surfaces first batch error', async () => {
    mockGetBatchQuotes.mockResolvedValue({
      data: [
        { symbol: 'AAPL', asset_type: 'stock', price: 100, change_pct_24h: 1.2, as_of: '2026-03-11T00:00:00+00:00', source: 'local' },
        { symbol: 'BTC', asset_type: 'crypto', error: 'Unable to fetch realtime price' },
      ],
      meta: { count: 2, success_count: 1, failed_count: 1, failed_symbols: ['BTC'] },
    })

    const { result } = renderHook(() =>
      useWatchlistQuotes([
        { symbol: 'AAPL', name: 'Apple', asset_type: 'stock', market: 'US' },
        { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' },
      ]),
    )

    await waitFor(() => {
      expect(result.current.rows).toHaveLength(2)
      expect(result.current.rows[0].price).toBe(100)
      expect(result.current.rows[1].price).toBeUndefined()
      expect(result.current.error).toBe('Unable to fetch realtime price')
    })
  })

  it('clears rows when watchlist is empty', async () => {
    const { result } = renderHook(() => useWatchlistQuotes([]))

    await waitFor(() => {
      expect(result.current.rows).toEqual([])
      expect(result.current.error).toBeNull()
    })
  })
})
