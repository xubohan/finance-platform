import { useEffect, useState } from 'react'

import type { SearchAsset } from '../api/market'
import { downloadFile } from '../utils/download'
import {
  clearRecentAssetsStorage,
  clearWatchlistAssetsStorage,
  mergeRecentAssets,
  parseRecentAssets,
  parseWatchlistAssets,
  persistRecentAssets,
  persistWatchlistAssets,
  RECENT_ASSETS_KEY,
  toggleWatchlistAsset,
  WATCHLIST_ASSETS_KEY,
} from '../utils/marketWorkspace'

export function useAssetCollections() {
  const [recentAssets, setRecentAssets] = useState<SearchAsset[]>(() =>
    parseRecentAssets(typeof window === 'undefined' ? null : window.localStorage.getItem(RECENT_ASSETS_KEY)),
  )
  const [watchlistAssets, setWatchlistAssets] = useState<SearchAsset[]>(() =>
    parseWatchlistAssets(typeof window === 'undefined' ? null : window.localStorage.getItem(WATCHLIST_ASSETS_KEY)),
  )

  useEffect(() => {
    try {
      setRecentAssets(parseRecentAssets(window.localStorage.getItem(RECENT_ASSETS_KEY)))
      setWatchlistAssets(parseWatchlistAssets(window.localStorage.getItem(WATCHLIST_ASSETS_KEY)))
    } catch {
      setRecentAssets([])
      setWatchlistAssets([])
    }
  }, [])

  const clearRecentAssets = () => {
    setRecentAssets([])
    clearRecentAssetsStorage()
  }

  const clearWatchlistAssets = () => {
    setWatchlistAssets([])
    clearWatchlistAssetsStorage()
  }

  const rememberAsset = (asset: SearchAsset) => {
    setRecentAssets((previous) => {
      const next = mergeRecentAssets(asset, previous)
      persistRecentAssets(next)
      return next
    })
  }

  const toggleWatchlist = (asset: SearchAsset) => {
    setWatchlistAssets((previous) => {
      const next = toggleWatchlistAsset(asset, previous)
      persistWatchlistAssets(next)
      return next
    })
  }

  const isWatchlisted = (asset: SearchAsset) =>
    watchlistAssets.some((item) => item.symbol === asset.symbol && item.asset_type === asset.asset_type)

  const exportWatchlistCsv = () => {
    if (!watchlistAssets.length) return
    const header = ['symbol', 'name', 'asset_type', 'market']
    const rows = watchlistAssets.map((asset) =>
      [asset.symbol, asset.name, asset.asset_type, asset.market ?? '']
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    )
    downloadFile(
      'market_workspace_watchlist.csv',
      [header.join(','), ...rows].join('\n'),
      'text/csv;charset=utf-8',
    )
  }

  return {
    recentAssets,
    watchlistAssets,
    clearRecentAssets,
    clearWatchlistAssets,
    rememberAsset,
    toggleWatchlist,
    isWatchlisted,
    exportWatchlistCsv,
  }
}
