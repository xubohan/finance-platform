import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useWorkspaceStorage } from './useWorkspaceStorage'

describe('useWorkspaceStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('restores persisted workspace state on initialization', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        selectedAsset: { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' },
        searchScope: 'crypto',
        period: '1M',
        strategyName: 'rsi_reversal',
        syncIfMissing: false,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.selectedAsset.symbol).toBe('BTC')
    expect(result.current.searchScope).toBe('crypto')
    expect(result.current.period).toBe('1M')
    expect(result.current.strategyName).toBe('rsi_reversal')
    expect(result.current.syncIfMissing).toBe(false)
  })

  it('applyInputAsset uses current input and scope to build the selected asset', () => {
    const { result } = renderHook(() => useWorkspaceStorage())

    act(() => {
      result.current.setSearchScope('crypto')
      result.current.setSearchInput('eth')
    })

    let asset = null
    act(() => {
      asset = result.current.applyInputAsset()
    })

    expect(asset).toEqual({
      symbol: 'ETH',
      name: 'ETH',
      asset_type: 'crypto',
      market: 'CRYPTO',
    })
    expect(result.current.selectedAsset.symbol).toBe('ETH')
  })

  it('resetWorkspace restores default values', () => {
    const { result } = renderHook(() => useWorkspaceStorage())

    act(() => {
      result.current.setSearchScope('crypto')
      result.current.setSearchInput('BTC')
      result.current.toggleIndicator('RSI')
      result.current.setSyncIfMissing(false)
      result.current.resetWorkspace()
    })

    expect(result.current.selectedAsset.symbol).toBe('AAPL')
    expect(result.current.searchScope).toBe('all')
    expect(result.current.searchInput).toBe('AAPL')
    expect(result.current.selectedIndicators).toEqual(['MA'])
    expect(result.current.syncIfMissing).toBe(true)
  })

  it('selectMoverAsset updates the selected asset and search input together', () => {
    const { result } = renderHook(() => useWorkspaceStorage())

    let asset = null
    act(() => {
      asset = result.current.selectMoverAsset('BTC', 'crypto')
    })

    expect(asset).toEqual({
      symbol: 'BTC',
      name: 'BTC',
      asset_type: 'crypto',
      market: 'CRYPTO',
    })
    expect(result.current.selectedAsset.symbol).toBe('BTC')
    expect(result.current.searchInput).toBe('BTC')
  })
})
