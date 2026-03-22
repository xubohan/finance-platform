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
import {
  getCacheMaintenance,
  getHealth,
  getObservability,
  type CacheMaintenanceResponse,
  type HealthResponse,
  type ObservabilityResponse,
} from '../api/system'
import { recordFrontendMetric } from '../utils/runtimePerformance'

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
  const [observability, setObservability] = useState<ObservabilityResponse | null>(null)
  const [observabilityError, setObservabilityError] = useState<string | null>(null)
  const [cacheMaintenance, setCacheMaintenance] = useState<CacheMaintenanceResponse | null>(null)
  const [cacheMaintenanceError, setCacheMaintenanceError] = useState<string | null>(null)

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
      const started = performance.now()
      try {
        const resp = await searchAssets(deferredSearch, searchScope, 8)
        if (!active) return
        setSearchResults(resp.data)
        recordFrontendMetric('workspace.search', performance.now() - started, { category: 'interaction' })
      } catch (error) {
        if (!active) return
        setSearchResults([])
        setSearchError(extractApiError(error, '搜索标的失败'))
        recordFrontendMetric('workspace.search', performance.now() - started, { category: 'interaction', status: 'error' })
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
      const started = performance.now()
      try {
        const [stocks, cryptos] = await Promise.all([getTopMovers('stock', 6), getTopMovers('crypto', 6)])
        if (!active) return
        setStockMovers(stocks.data)
        setCryptoMovers(cryptos.data)
        setStockMoversMeta(stocks.meta ?? null)
        setCryptoMoversMeta(cryptos.meta ?? null)
        recordFrontendMetric('workspace.movers', performance.now() - started, { category: 'network' })
      } catch (error) {
        if (!active) return
        setStockMoversMeta(null)
        setCryptoMoversMeta(null)
        setMoversError(extractApiError(error, '加载市场动量失败'))
        recordFrontendMetric('workspace.movers', performance.now() - started, { category: 'network', status: 'error' })
      }
    }

    void loadMovers()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadRuntimeState = async () => {
      const started = performance.now()
      const [healthResp, observabilityResp, cacheMaintenanceResp] = await Promise.allSettled([
        getHealth(),
        getObservability(),
        getCacheMaintenance(),
      ])
      if (!active) return

      if (healthResp.status === 'fulfilled') {
        setHealth(healthResp.value)
        setHealthError(null)
      } else {
        setHealth(null)
        setHealthError(extractApiError(healthResp.reason, '加载运行模式失败'))
      }

      if (observabilityResp.status === 'fulfilled') {
        setObservability(observabilityResp.value)
        setObservabilityError(null)
      } else {
        setObservability(null)
        setObservabilityError(extractApiError(observabilityResp.reason, '加载运行观测失败'))
      }

      if (cacheMaintenanceResp.status === 'fulfilled') {
        setCacheMaintenance(cacheMaintenanceResp.value)
        setCacheMaintenanceError(null)
      } else {
        setCacheMaintenance(null)
        setCacheMaintenanceError(extractApiError(cacheMaintenanceResp.reason, '加载缓存维护状态失败'))
      }

      const hasError =
        healthResp.status !== 'fulfilled' ||
        observabilityResp.status !== 'fulfilled' ||
        cacheMaintenanceResp.status !== 'fulfilled'
      recordFrontendMetric('workspace.runtimeState', performance.now() - started, {
        category: 'network',
        status: hasError ? 'error' : 'success',
      })
    }

    void loadRuntimeState()
    const timer = window.setInterval(() => {
      void loadRuntimeState()
    }, 30000)

    return () => {
      active = false
      window.clearInterval(timer)
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
    observability,
    observabilityError,
    cacheMaintenance,
    cacheMaintenanceError,
  }
}
