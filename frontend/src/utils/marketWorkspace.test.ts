import { describe, expect, it } from 'vitest'

import {
  createDefaultWorkspaceState,
  mergeRecentAssets,
  parseRecentAssets,
  parseWorkspaceState,
} from './marketWorkspace'

describe('marketWorkspace utils', () => {
  it('filters invalid recent assets from localStorage payloads', () => {
    const assets = parseRecentAssets(
      JSON.stringify([
        { symbol: 'btc', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' },
        { symbol: 'bad', name: 'Broken', asset_type: 'broken' },
      ]),
    )

    expect(assets).toHaveLength(1)
    expect(assets[0].symbol).toBe('BTC')
  })

  it('parses workspace state with semantic validation', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        selectedAsset: { symbol: 'msft', name: 'Microsoft', asset_type: 'stock', market: 'US' },
        searchScope: 'stock',
        period: '1d',
        chartStartDate: '2026-01-01',
        chartEndDate: '2026-01-31',
        strategyName: 'ma_cross',
        fast: 10,
        slow: 30,
        initialCapital: 200000,
        syncIfMissing: false,
      }),
    )

    expect(state.selectedAsset?.symbol).toBe('MSFT')
    expect(state.fast).toBe(10)
    expect(state.searchScope).toBe('stock')
    expect(state.syncIfMissing).toBe(false)
  })

  it('merges recent assets without duplicating the same asset', () => {
    const defaults = createDefaultWorkspaceState()
    const merged = mergeRecentAssets(defaults.selectedAsset, [
      defaults.selectedAsset,
      { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0].symbol).toBe('AAPL')
    expect(merged[1].symbol).toBe('BTC')
  })
})
