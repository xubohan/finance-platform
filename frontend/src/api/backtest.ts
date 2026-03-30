import client from './client'
import type { BacktestStrategyName } from '../utils/backtestStrategies'

export type BacktestCompareRankingMetric =
  | 'total_return'
  | 'annual_return'
  | 'sharpe_ratio'
  | 'max_drawdown'
  | 'win_rate'
  | 'trade_count'

export type BacktestTaskKind = 'run' | 'compare' | 'lab'
export type BacktestTaskStatus = 'queued' | 'running' | 'completed' | 'failed'

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

export type BacktestCurveSeries = {
  strategy_name?: BacktestStrategyName
  label: string
  points: BacktestCurvePoint[]
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
  benchmark_curve?: BacktestCurvePoint[]
  trades: BacktestTrade[]
  metrics: BacktestMetrics
}

export type BacktestRunMeta = {
  ohlcv_source?: 'cache' | 'live' | 'persisted'
  stale?: boolean
  as_of?: string | null
  fetch_source?: string
  source?: string
  storage_source?: 'cache' | 'live' | 'persisted'
  sync_performed?: boolean
  provider?: string
  coverage_complete?: boolean
  execution_mode?: 'sync' | 'celery' | 'persisted'
  accepted_at?: string
  task_id?: string
  task_kind?: BacktestTaskKind
  task_name?: string
}

export type BacktestAsyncState = {
  status?: BacktestTaskStatus | string
  task_id?: string
  task_kind?: BacktestTaskKind
}

export type BacktestRunResponse = {
  data: BacktestRunData | BacktestAsyncState | null
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
  data: BacktestCompareRow[] | BacktestAsyncState
  curves: BacktestCurveSeries[] | []
  meta: BacktestCompareMeta
}

export type BacktestTaskResultPayload =
  | BacktestRunResponse
  | BacktestCompareResponse
  | BacktestLabResponse
  | Record<string, unknown>

export type BacktestTaskResponse = {
  data?: {
    task_id?: string
    status?: BacktestTaskStatus | string
    task_kind?: BacktestTaskKind
    symbol?: string
    asset_type?: 'stock' | 'crypto'
    strategy_name?: BacktestStrategyName
    parameters?: Record<string, number>
    window?: {
      start_date?: string
      end_date?: string
    }
    result?: {
      total_return?: number
      annual_return?: number
      sharpe_ratio?: number
      max_drawdown?: number
      win_rate?: number
      trade_count?: number
      equity_curve?: BacktestCurvePoint[]
      trade_records?: BacktestTrade[]
      created_at?: string
    } | null
    result_payload?: BacktestTaskResultPayload | null
    error?: string
  }
  meta?: {
    generated_at?: string
    execution_mode?: 'sync' | 'celery' | 'persisted'
    accepted_at?: string
    task_name?: string
  }
}

export function extractBacktestTaskId(response?: { data?: unknown; meta?: unknown } | null): string | null {
  const candidates: unknown[] = []
  if (response && typeof response === 'object') {
    const responseRecord = response as { data?: unknown; meta?: unknown }
    if (responseRecord.data && typeof responseRecord.data === 'object') {
      const dataRecord = responseRecord.data as Record<string, unknown>
      candidates.push(dataRecord.task_id, dataRecord.taskId, dataRecord.compare_task_id)
    }
    if (responseRecord.meta && typeof responseRecord.meta === 'object') {
      const metaRecord = responseRecord.meta as Record<string, unknown>
      candidates.push(metaRecord.task_id, metaRecord.taskId, metaRecord.compare_task_id)
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return null
}

export async function runBacktest(payload: BacktestRequest, options?: { asyncMode?: boolean }) {
  const resp = await client.post('/backtest/run', payload, {
    params: options?.asyncMode ? { async_mode: true } : undefined,
  })
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

export async function compareBacktestStrategies(payload: BacktestCompareRequest, options?: { asyncMode?: boolean }) {
  const resp = await client.post('/backtest/compare', payload, {
    params: options?.asyncMode ? { async_mode: true } : undefined,
  })
  return {
    data: resp.data?.data ?? [],
    curves: resp.data?.curves ?? [],
    meta: resp.data?.meta ?? {},
  } as BacktestCompareResponse
}

export async function getBacktestTask(taskId: string) {
  const resp = await client.get(`/backtest/tasks/${encodeURIComponent(taskId)}`)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as BacktestTaskResponse
}

export type BacktestLabRequest = {
  market: 'us' | 'cn'
  symbols?: string[]
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
  count?: number
  total_items?: number
  total_pages?: number
  page?: number
  page_size?: number
  market?: 'us' | 'cn'
  requested_symbols?: string[]
  symbols_fetched?: number
  symbols_backtested?: number
  total_available?: number
  source?: 'cache' | 'live' | 'manual' | 'persisted'
  stale?: boolean
  as_of?: string | null
  cache_age_sec?: number | null
  ohlcv_live_symbols?: number
  ohlcv_synced_symbols?: number
  ohlcv_failed_symbols?: number
  execution_mode?: 'sync' | 'celery' | 'persisted'
  accepted_at?: string
  task_id?: string
  task_kind?: BacktestTaskKind
  task_name?: string
}

export type BacktestLabResponse = {
  data: BacktestLabRow[] | BacktestAsyncState | null
  meta: BacktestLabMeta
}

export async function runBacktestLab(payload: BacktestLabRequest, options?: { asyncMode?: boolean }) {
  const resp = await client.post('/backtest/lab', {
    force_refresh: true,
    allow_stale: false,
    ...payload,
  }, {
    params: options?.asyncMode ? { async_mode: true } : undefined,
  })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as BacktestLabResponse
}
