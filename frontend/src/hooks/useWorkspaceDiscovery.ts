import { useDeferredValue, useEffect, useState } from 'react'

import { extractApiError } from '../api/client'
import {
  getTopMovers,
  searchAssets,
  type SearchAsset,
  type SearchAssetType,
  type TopMoversMeta,
  type TopMoverRow,
} from '../api/market'
import { getHealth, type HealthResponse } from '../api/system'

export function useWorkspaceDiscovery(searchInput: string, searchScope: SearchAssetType) {
  const deferredSearch = useDeferredValue(searchInput.trim())

  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<SearchAsset[]>([])

  const [stockMovers, setStockMovers] = useState<TopMoverRow[]>([])
  const [cryptoMovers, setCryptoMovers] = useState<TopMoverRow[]>([])
  const [stockMoversMeta, setStockMoversMeta] = useState<TopMoversMeta | null>(null)
  const [cryptoMoversMeta, setCryptoMoversMeta] = useState<TopMoversMeta | null>(null)
  const [moversError, setMoversError] = useState<string | null>(null)

  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)

  useEffect(() => {
    if (deferredSearch.length < 1) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    let active = true

    const loadSearch = async () => {
      setSearchLoading(true)
      setSearchError(null)
      try {
        const resp = await searchAssets(deferredSearch, searchScope, 8)
        if (!active) return
        setSearchResults(resp.data)
      } catch (error) {
        if (!active) return
        setSearchResults([])
        setSearchError(extractApiError(error, '搜索标的失败'))
      } finally {
        if (active) {
          setSearchLoading(false)
        }
      }
    }

    void loadSearch()

    return () => {
      active = false
    }
  }, [deferredSearch, searchScope])

  useEffect(() => {
    let active = true

    const loadMovers = async () => {
      setMoversError(null)
      try {
        const [stocks, cryptos] = await Promise.all([getTopMovers('stock', 6), getTopMovers('crypto', 6)])
        if (!active) return
        setStockMovers(stocks.data)
        setCryptoMovers(cryptos.data)
        setStockMoversMeta(stocks.meta ?? null)
        setCryptoMoversMeta(cryptos.meta ?? null)
      } catch (error) {
        if (!active) return
        setStockMoversMeta(null)
        setCryptoMoversMeta(null)
        setMoversError(extractApiError(error, '加载市场动量失败'))
      }
    }

    void loadMovers()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadHealth = async () => {
      setHealthError(null)
      try {
        const resp = await getHealth()
        if (!active) return
        setHealth(resp)
      } catch (error) {
        if (!active) return
        setHealth(null)
        setHealthError(extractApiError(error, '加载运行模式失败'))
      }
    }

    void loadHealth()

    return () => {
      active = false
    }
  }, [])

  const clearSearchResults = () => {
    setSearchResults([])
    setSearchError(null)
  }

  return {
    deferredSearch,
    searchLoading,
    searchError,
    searchResults,
    clearSearchResults,
    stockMovers,
    cryptoMovers,
    stockMoversMeta,
    cryptoMoversMeta,
    moversError,
    health,
    healthError,
  }
}
