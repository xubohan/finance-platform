import client from './client'

export type BacktestRequest = {
  symbol: string
  asset_type: 'stock' | 'crypto'
  strategy_name: 'ma_cross' | 'macd_signal' | 'rsi_reversal'
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

export async function runBacktest(payload: BacktestRequest) {
  const resp = await client.post('/backtest/run', payload)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as BacktestRunResponse
}

export type BacktestLabRequest = {
  market: 'us' | 'cn'
  strategy_name: 'ma_cross' | 'macd_signal' | 'rsi_reversal'
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
