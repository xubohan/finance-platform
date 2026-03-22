import { startTransition, useEffect, useRef, useState } from 'react'

import type { BacktestCompareRankingMetric } from '../api/backtest'
import type { AssetType, MarketPeriod, SearchAsset, SearchAssetType } from '../api/market'
import {
  createDefaultWorkspaceState,
  inferAssetType,
  inferMarket,
  persistWorkspaceState,
  readInitialWorkspaceState,
} from '../utils/marketWorkspace'
import type { BacktestStrategyName } from '../utils/backtestStrategies'
import { daysAgo, toDateInputLocal, yearStart, yearsAgo } from '../utils/time'

export function useWorkspaceStorage() {
  const initialWorkspaceRef = useRef<ReturnType<typeof createDefaultWorkspaceState> | null>(null)
  if (initialWorkspaceRef.current === null) {
    initialWorkspaceRef.current = readInitialWorkspaceState()
  }
  const initialWorkspace = initialWorkspaceRef.current

  const [searchScope, setSearchScope] = useState<SearchAssetType>(initialWorkspace.searchScope)
  const [searchInput, setSearchInput] = useState(initialWorkspace.searchInput)
  const [selectedAsset, setSelectedAsset] = useState<SearchAsset>(initialWorkspace.selectedAsset)

  const [period, setPeriod] = useState<MarketPeriod>(initialWorkspace.period)
  const [chartStartDate, setChartStartDate] = useState(initialWorkspace.chartStartDate)
  const [chartEndDate, setChartEndDate] = useState(initialWorkspace.chartEndDate)
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>(['MA'])

  const [strategyName, setStrategyName] = useState<BacktestStrategyName>(initialWorkspace.strategyName)
  const [fast, setFast] = useState(initialWorkspace.fast)
  const [slow, setSlow] = useState(initialWorkspace.slow)
  const [rsiPeriod, setRsiPeriod] = useState(initialWorkspace.rsiPeriod)
  const [oversold, setOversold] = useState(initialWorkspace.oversold)
  const [overbought, setOverbought] = useState(initialWorkspace.overbought)
  const [initialCapital, setInitialCapital] = useState(initialWorkspace.initialCapital)
  const [backtestStartDate, setBacktestStartDate] = useState(initialWorkspace.backtestStartDate)
  const [backtestEndDate, setBacktestEndDate] = useState(initialWorkspace.backtestEndDate)
  const [syncIfMissing, setSyncIfMissing] = useState(initialWorkspace.syncIfMissing)
  const [backtestTradesPage, setBacktestTradesPage] = useState(initialWorkspace.backtestTradesPage)
  const [compareStrategyNames, setCompareStrategyNames] = useState(initialWorkspace.compareStrategyNames)
  const [compareRankingMetric, setCompareRankingMetric] = useState<BacktestCompareRankingMetric>(
    initialWorkspace.compareRankingMetric,
  )

  useEffect(() => {
    const payload = {
      selectedAsset,
      searchScope,
      period,
      chartStartDate,
      chartEndDate,
      strategyName,
      fast,
      slow,
      rsiPeriod,
      oversold,
      overbought,
      initialCapital,
      backtestStartDate,
      backtestEndDate,
      syncIfMissing,
      backtestTradesPage,
      compareStrategyNames,
      compareRankingMetric,
    }
    try {
      persistWorkspaceState(payload)
    } catch {
      // Ignore quota errors and keep runtime state in memory.
    }
  }, [
    backtestEndDate,
    backtestStartDate,
    chartEndDate,
    chartStartDate,
    fast,
    initialCapital,
    overbought,
    oversold,
    period,
    rsiPeriod,
    searchScope,
    selectedAsset,
    slow,
    strategyName,
    syncIfMissing,
    backtestTradesPage,
    compareStrategyNames,
    compareRankingMetric,
  ])

  const selectAsset = (asset: SearchAsset, inputOverride?: string) => {
    startTransition(() => {
      setSelectedAsset(asset)
      setSearchInput(inputOverride ?? asset.symbol)
    })
  }

  const applyInputAsset = () => {
    const normalized = searchInput.trim().toUpperCase()
    if (!normalized) return null

    const asset = {
      symbol: normalized,
      name: normalized,
      asset_type: inferAssetType(normalized, searchScope),
      market: inferMarket(searchScope),
    }

    selectAsset(asset)
    return asset
  }

  const selectMoverAsset = (symbol: string, assetType: AssetType) => {
    const asset = {
      symbol,
      name: symbol,
      asset_type: assetType,
      market: assetType === 'crypto' ? 'CRYPTO' : 'WATCHLIST',
    }
    selectAsset(asset, symbol)
    return asset
  }

  const resetWorkspace = () => {
    const next = createDefaultWorkspaceState()
    startTransition(() => {
      setSelectedAsset(next.selectedAsset)
      setSearchScope(next.searchScope)
      setSearchInput(next.searchInput)
      setPeriod(next.period)
      setChartStartDate(next.chartStartDate)
      setChartEndDate(next.chartEndDate)
      setStrategyName(next.strategyName)
      setFast(next.fast)
      setSlow(next.slow)
      setRsiPeriod(next.rsiPeriod)
      setOversold(next.oversold)
      setOverbought(next.overbought)
      setInitialCapital(next.initialCapital)
      setBacktestStartDate(next.backtestStartDate)
      setBacktestEndDate(next.backtestEndDate)
      setSyncIfMissing(next.syncIfMissing)
      setBacktestTradesPage(next.backtestTradesPage)
      setCompareStrategyNames(next.compareStrategyNames)
      setCompareRankingMetric(next.compareRankingMetric)
      setSelectedIndicators(['MA'])
    })
    return next
  }

  const toggleCompareStrategy = (name: BacktestStrategyName) => {
    setCompareStrategyNames((previous) =>
      previous.includes(name)
        ? previous.filter((item) => item !== name)
        : previous.length >= 8
          ? previous
          : [...previous, name],
    )
  }

  const replaceCompareStrategies = (names: BacktestStrategyName[]) => {
    setCompareStrategyNames(Array.from(new Set(names)).slice(0, 8))
  }

  const toggleIndicator = (name: string) => {
    setSelectedIndicators((previous) =>
      previous.includes(name) ? previous.filter((item) => item !== name) : [...previous, name],
    )
  }

  const applyChartPreset = (preset: string) => {
    const today = toDateInputLocal(new Date())
    if (preset === 'ytd') {
      setChartStartDate(yearStart())
      setChartEndDate(today)
      return
    }
    if (preset === '1m') {
      setChartStartDate(daysAgo(30))
      setChartEndDate(today)
      return
    }
    if (preset === '3m') {
      setChartStartDate(daysAgo(90))
      setChartEndDate(today)
      return
    }
    if (preset === '6m') {
      setChartStartDate(daysAgo(180))
      setChartEndDate(today)
      return
    }
    if (preset === '1y') {
      setChartStartDate(daysAgo(365))
      setChartEndDate(today)
      return
    }
    if (preset === '3y') {
      setChartStartDate(yearsAgo(3))
      setChartEndDate(today)
    }
  }

  const applyBacktestPreset = (preset: string) => {
    const today = toDateInputLocal(new Date())
    if (preset === '6m') {
      setBacktestStartDate(daysAgo(180))
      setBacktestEndDate(today)
      return
    }
    if (preset === '1y') {
      setBacktestStartDate(daysAgo(365))
      setBacktestEndDate(today)
      return
    }
    if (preset === '3y') {
      setBacktestStartDate(yearsAgo(3))
      setBacktestEndDate(today)
      return
    }
    if (preset === '5y') {
      setBacktestStartDate(yearsAgo(5))
      setBacktestEndDate(today)
    }
  }

  return {
    searchScope,
    setSearchScope,
    searchInput,
    setSearchInput,
    selectedAsset,
    period,
    setPeriod,
    chartStartDate,
    setChartStartDate,
    chartEndDate,
    setChartEndDate,
    selectedIndicators,
    strategyName,
    setStrategyName,
    fast,
    setFast,
    slow,
    setSlow,
    rsiPeriod,
    setRsiPeriod,
    oversold,
    setOversold,
    overbought,
    setOverbought,
    initialCapital,
    setInitialCapital,
    backtestStartDate,
    setBacktestStartDate,
    backtestEndDate,
    setBacktestEndDate,
    syncIfMissing,
    setSyncIfMissing,
    backtestTradesPage,
    setBacktestTradesPage,
    compareStrategyNames,
    compareRankingMetric,
    setCompareRankingMetric,
    toggleCompareStrategy,
    replaceCompareStrategies,
    selectAsset,
    applyInputAsset,
    selectMoverAsset,
    resetWorkspace,
    toggleIndicator,
    applyChartPreset,
    applyBacktestPreset,
  }
}
