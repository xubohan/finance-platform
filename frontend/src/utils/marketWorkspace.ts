import type { AssetType, MarketPeriod, SearchAsset, SearchAssetType } from '../api/market'
import type { BacktestCompareRankingMetric } from '../api/backtest'
import { BACKTEST_STRATEGY_VALUES, DEFAULT_COMPARE_STRATEGIES, type BacktestStrategyName } from './backtestStrategies'

import { daysAgo, toDateInputLocal } from './time'

export const RECENT_ASSETS_KEY = 'market-workspace:recent-assets'
export const WATCHLIST_ASSETS_KEY = 'market-workspace:watchlist-assets'
export const WORKSPACE_STATE_KEY = 'market-workspace:state'

export const defaultAsset: SearchAsset = {
  symbol: 'AAPL',
  name: 'Apple Inc.',
  asset_type: 'stock',
  market: 'US',
}

const cryptoSymbols = new Set(['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE'])
const VALID_ASSET_TYPES = new Set<AssetType>(['stock', 'crypto'])
const VALID_SEARCH_SCOPES = new Set<SearchAssetType>(['all', 'stock', 'crypto'])
const VALID_PERIODS = new Set<MarketPeriod>(['1d', '1W', '1M'])
const VALID_STRATEGIES = new Set<BacktestStrategyName>(BACKTEST_STRATEGY_VALUES)
const VALID_COMPARE_RANKING_METRICS = new Set<BacktestCompareRankingMetric>([
  'total_return',
  'annual_return',
  'sharpe_ratio',
  'max_drawdown',
  'win_rate',
  'trade_count',
])

export type PersistedWorkspaceState = {
  selectedAsset?: SearchAsset
  searchScope?: SearchAssetType
  period?: MarketPeriod
  chartStartDate?: string
  chartEndDate?: string
  strategyName?: BacktestStrategyName
  fast?: number
  slow?: number
  rsiPeriod?: number
  oversold?: number
  overbought?: number
  initialCapital?: number
  backtestStartDate?: string
  backtestEndDate?: string
  syncIfMissing?: boolean
  backtestTradesPage?: number
  compareStrategyNames?: BacktestStrategyName[]
  compareRankingMetric?: BacktestCompareRankingMetric
}

export type WorkspaceState = ReturnType<typeof createDefaultWorkspaceState>

export function inferAssetType(symbol: string, scope: SearchAssetType): AssetType {
  if (scope === 'crypto' || cryptoSymbols.has(symbol)) return 'crypto'
  return 'stock'
}

export function inferMarket(scope: SearchAssetType): string {
  if (scope === 'crypto') return 'CRYPTO'
  if (scope === 'stock') return 'WATCHLIST'
  return '-'
}

export function isValidDateInput(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

export function sanitizeAsset(value: unknown): SearchAsset | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SearchAsset>
  const symbol = typeof candidate.symbol === 'string' ? candidate.symbol.trim().toUpperCase() : ''
  const assetType = candidate.asset_type
  if (!symbol || !assetType || !VALID_ASSET_TYPES.has(assetType)) {
    return null
  }
  return {
    symbol,
    asset_type: assetType,
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : symbol,
    market: typeof candidate.market === 'string' ? candidate.market.trim() : null,
  }
}

export function readFiniteNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < min || value > max) return null
  return value
}

export function createDefaultWorkspaceState() {
  return {
    selectedAsset: defaultAsset,
    searchScope: 'all' as SearchAssetType,
    searchInput: defaultAsset.symbol,
    period: '1d' as MarketPeriod,
    chartStartDate: daysAgo(180),
    chartEndDate: toDateInputLocal(new Date()),
    strategyName: 'ma_cross' as const,
    fast: 5,
    slow: 20,
    rsiPeriod: 14,
    oversold: 30,
    overbought: 70,
    initialCapital: 100000,
    backtestStartDate: daysAgo(365),
    backtestEndDate: toDateInputLocal(new Date()),
    syncIfMissing: true,
    backtestTradesPage: 1,
    compareStrategyNames: [...DEFAULT_COMPARE_STRATEGIES],
    compareRankingMetric: 'total_return' as const,
  }
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function readInitialWorkspaceState(): WorkspaceState {
  const defaults = createDefaultWorkspaceState()
  const restored = parseWorkspaceState(readStorage(WORKSPACE_STATE_KEY))

  return {
    ...defaults,
    ...restored,
    selectedAsset: restored.selectedAsset ?? defaults.selectedAsset,
    searchInput: restored.selectedAsset?.symbol ?? defaults.searchInput,
  }
}

export function parseAssetList(raw: string | null): SearchAsset[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => sanitizeAsset(item)).filter((item): item is SearchAsset => item !== null).slice(0, 8)
  } catch {
    return []
  }
}

export function parseRecentAssets(raw: string | null): SearchAsset[] {
  return parseAssetList(raw)
}

export function parseWatchlistAssets(raw: string | null): SearchAsset[] {
  return parseAssetList(raw)
}

export function parseWorkspaceState(raw: string | null): Partial<PersistedWorkspaceState> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as PersistedWorkspaceState
    const restored: Partial<PersistedWorkspaceState> = {}
    const restoredAsset = sanitizeAsset(parsed.selectedAsset)
    if (restoredAsset) restored.selectedAsset = restoredAsset
    if (parsed.searchScope && VALID_SEARCH_SCOPES.has(parsed.searchScope)) restored.searchScope = parsed.searchScope
    if (parsed.period && VALID_PERIODS.has(parsed.period)) restored.period = parsed.period
    if (isValidDateInput(parsed.chartStartDate)) restored.chartStartDate = parsed.chartStartDate
    if (isValidDateInput(parsed.chartEndDate)) restored.chartEndDate = parsed.chartEndDate
    if (parsed.strategyName && VALID_STRATEGIES.has(parsed.strategyName)) restored.strategyName = parsed.strategyName

    const restoredFast = readFiniteNumber(parsed.fast, 1, 250)
    const restoredSlow = readFiniteNumber(parsed.slow, 2, 400)
    const restoredRsiPeriod = readFiniteNumber(parsed.rsiPeriod, 2, 100)
    const restoredOversold = readFiniteNumber(parsed.oversold, -1000, 1000)
    const restoredOverbought = readFiniteNumber(parsed.overbought, -1000, 1000)
    const restoredCapital = readFiniteNumber(parsed.initialCapital, 1000, 1_000_000_000)

    if (restoredFast !== null) restored.fast = restoredFast
    if (restoredSlow !== null) restored.slow = restoredSlow
    if (restoredRsiPeriod !== null) restored.rsiPeriod = restoredRsiPeriod
    if (restoredOversold !== null) restored.oversold = restoredOversold
    if (restoredOverbought !== null) restored.overbought = restoredOverbought
    if (restoredCapital !== null) restored.initialCapital = restoredCapital
    if (isValidDateInput(parsed.backtestStartDate)) restored.backtestStartDate = parsed.backtestStartDate
    if (isValidDateInput(parsed.backtestEndDate)) restored.backtestEndDate = parsed.backtestEndDate
    if (typeof parsed.syncIfMissing === 'boolean') restored.syncIfMissing = parsed.syncIfMissing
    const restoredBacktestTradesPage = readFiniteNumber(parsed.backtestTradesPage, 1, 999)
    if (restoredBacktestTradesPage !== null) restored.backtestTradesPage = restoredBacktestTradesPage
    if (
      parsed.compareRankingMetric &&
      VALID_COMPARE_RANKING_METRICS.has(parsed.compareRankingMetric)
    ) {
      restored.compareRankingMetric = parsed.compareRankingMetric
    }
    if (Array.isArray(parsed.compareStrategyNames)) {
      const compareStrategyNames = Array.from(
        new Set(
          parsed.compareStrategyNames.filter(
            (name): name is BacktestStrategyName =>
              typeof name === 'string' && VALID_STRATEGIES.has(name as BacktestStrategyName),
          ),
        ),
      ).slice(0, 8)
      if (parsed.compareStrategyNames.length === 0 || compareStrategyNames.length > 0) {
        restored.compareStrategyNames = compareStrategyNames
      }
    }

    return restored
  } catch {
    return {}
  }
}

export function mergeRecentAssets(selectedAsset: SearchAsset, previous: SearchAsset[]): SearchAsset[] {
  return [
    selectedAsset,
    ...previous.filter(
      (item) => !(item.symbol === selectedAsset.symbol && item.asset_type === selectedAsset.asset_type),
    ),
  ].slice(0, 8)
}

export function toggleWatchlistAsset(selectedAsset: SearchAsset, previous: SearchAsset[]): SearchAsset[] {
  const exists = previous.some(
    (item) => item.symbol === selectedAsset.symbol && item.asset_type === selectedAsset.asset_type,
  )
  if (exists) {
    return previous.filter(
      (item) => !(item.symbol === selectedAsset.symbol && item.asset_type === selectedAsset.asset_type),
    )
  }
  return [selectedAsset, ...previous].slice(0, 16)
}

export function persistRecentAssets(items: SearchAsset[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(items))
}

export function clearRecentAssetsStorage() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(RECENT_ASSETS_KEY)
}

export function persistWatchlistAssets(items: SearchAsset[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(WATCHLIST_ASSETS_KEY, JSON.stringify(items))
}

export function clearWatchlistAssetsStorage() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(WATCHLIST_ASSETS_KEY)
}

export function persistWorkspaceState(state: PersistedWorkspaceState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(WORKSPACE_STATE_KEY, JSON.stringify(state))
}

export function clearWorkspaceStateStorage() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(WORKSPACE_STATE_KEY)
}
