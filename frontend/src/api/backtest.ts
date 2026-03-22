import client from './client'
import type { BacktestStrategyName } from '../utils/backtestStrategies'

export type BacktestCompareRankingMetric =
  | 'total_return'
  | 'annual_return'
  | 'sharpe_ratio'
  | 'max_drawdown'
  | 'win_rate'
  | 'trade_count'

export type BacktestRequest = {
  symbol: string
  asset_type: 'stock' | 'crypto'
  strategy_name: BacktestStrategyName
  parameters: Record<string, number>
  start_date: string
  end_date: string
  initial_capital: number
  sync_if_missing?: boolean
}

export type BacktestCurvePoint = {
  date: string
  value: number
}

export type BacktestTrade = {
  date: string
  symbol: string
  action: string
  price: number
  shares: number
  commission: number
  pnl?: number
}

export type BacktestMetrics = {
  total_return?: number
  annual_return?: number
  sharpe_ratio?: number
  max_drawdown?: number
  win_rate?: number
  trade_count?: number
}

export type BacktestRunData = {
  equity_curve: BacktestCurvePoint[]
  trades: BacktestTrade[]
  metrics: BacktestMetrics
}

export type BacktestRunMeta = {
  ohlcv_source?: 'cache' | 'live' | 'mixed' | 'local'
  stale?: boolean
  as_of?: string | null
  fetch_source?: string
  source?: string
  storage_source?: 'cache' | 'live' | 'mixed' | 'local'
  sync_performed?: boolean
  provider?: string
  coverage_complete?: boolean
}

export type BacktestRunResponse = {
  data: BacktestRunData | null
  meta: BacktestRunMeta
}

export type BacktestStrategyCatalogEntry = {
  name: BacktestStrategyName
  label: string
  parameter_mode: 'fast_slow' | 'oscillator' | 'threshold' | 'period_multiplier' | 'special' | 'none'
  summary: string
}

export type BacktestStrategyCatalogResponse = {
  data: BacktestStrategyCatalogEntry[]
  meta: { count?: number }
}

export type BacktestCompareRequest = {
  symbol: string
  asset_type: 'stock' | 'crypto'
  strategy_names: BacktestStrategyName[]
  parameters_by_strategy?: Record<string, Record<string, number>>
  start_date: string
  end_date: string
  initial_capital: number
  sync_if_missing?: boolean
  ranking_metric?: BacktestCompareRankingMetric
}

export type BacktestCompareRow = {
  strategy_name: BacktestStrategyName
  label: string
  total_return: number
  annual_return: number
  sharpe_ratio: number
  max_drawdown: number
  win_rate: number
  trade_count: number
}

export type BacktestCompareMeta = BacktestRunMeta & { count?: number; ranking_metric?: BacktestCompareRankingMetric }

export type BacktestCompareResponse = {
  data: BacktestCompareRow[]
  meta: BacktestCompareMeta
}

export async function runBacktest(payload: BacktestRequest) {
  const resp = await client.post('/backtest/run', payload)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as BacktestRunResponse
}

export async function getBacktestStrategies() {
  const resp = await client.get('/backtest/strategies')
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as BacktestStrategyCatalogResponse
}

export async function compareBacktestStrategies(payload: BacktestCompareRequest) {
  const resp = await client.post('/backtest/compare', payload)
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as BacktestCompareResponse
}

export type BacktestLabRequest = {
  market: 'us' | 'cn'
  strategy_name: BacktestStrategyName
  parameters: Record<string, number>
  start_date: string
  end_date: string
  initial_capital: number
  symbol_limit?: number
  page?: number
  page_size?: number
  force_refresh?: boolean
  allow_stale?: boolean
}

export type BacktestLabRow = {
  symbol: string
  name: string
  market: string
  total_return: number
  annual_return: number
  sharpe_ratio: number
  max_drawdown: number
  win_rate: number
  trade_count: number
}

export type BacktestLabMeta = {
  count: number
  total_items?: number
  total_pages?: number
  page?: number
  page_size?: number
  market: 'us' | 'cn'
  symbols_fetched?: number
  symbols_backtested?: number
  total_available?: number
  source?: 'cache' | 'live' | 'mixed'
  stale?: boolean
  as_of?: string | null
  cache_age_sec?: number | null
  ohlcv_live_symbols?: number
  ohlcv_failed_symbols?: number
  ohlcv_local_fallback_symbols?: number
}

export type BacktestLabResponse = {
  data: BacktestLabRow[]
  meta: BacktestLabMeta
}

export async function runBacktestLab(payload: BacktestLabRequest) {
  const resp = await client.post('/backtest/lab', {
    force_refresh: true,
    allow_stale: false,
    ...payload,
  })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as BacktestLabResponse
}
