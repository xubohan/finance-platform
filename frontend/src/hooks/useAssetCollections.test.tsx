import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAssetCollections } from './useAssetCollections'

const mockDownloadFile = vi.fn()

vi.mock('../utils/download', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}))

describe('useAssetCollections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
  })

  it('remembers assets without duplicating the same symbol', () => {
    const { result } = renderHook(() => useAssetCollections())

    act(() => {
      result.current.rememberAsset({ symbol: 'AAPL', name: 'Apple', asset_type: 'stock', market: 'US' })
      result.current.rememberAsset({ symbol: 'AAPL', name: 'Apple', asset_type: 'stock', market: 'US' })
      result.current.rememberAsset({ symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' })
    })

    expect(result.current.recentAssets).toHaveLength(2)
    expect(result.current.recentAssets[0].symbol).toBe('BTC')
    expect(result.current.recentAssets[1].symbol).toBe('AAPL')
  })

  it('toggles watchlist membership and clears it', () => {
    const asset = { symbol: 'AAPL', name: 'Apple', asset_type: 'stock' as const, market: 'US' }
    const { result } = renderHook(() => useAssetCollections())

    act(() => {
      result.current.toggleWatchlist(asset)
    })
    expect(result.current.isWatchlisted(asset)).toBe(true)

    act(() => {
      result.current.toggleWatchlist(asset)
    })
    expect(result.current.isWatchlisted(asset)).toBe(false)

    act(() => {
      result.current.toggleWatchlist(asset)
    })

    act(() => {
      result.current.clearWatchlistAssets()
    })
    expect(result.current.watchlistAssets).toEqual([])
    expect(window.localStorage.getItem('market-workspace:watchlist-assets')).toBeNull()
  })

  it('exports watchlist as csv through the download helper', () => {
    const { result } = renderHook(() => useAssetCollections())

    act(() => {
      result.current.toggleWatchlist({ symbol: 'AAPL', name: 'Apple', asset_type: 'stock', market: 'US' })
      result.current.toggleWatchlist({ symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' })
    })

    act(() => {
      result.current.exportWatchlistCsv()
    })

    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
    expect(mockDownloadFile.mock.calls[0][0]).toBe('market_workspace_watchlist.csv')
  })
})
