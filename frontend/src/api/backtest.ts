import client from './client'

export type BacktestRequest = {
  symbol: string
  asset_type: 'stock' | 'crypto'
  strategy_name: 'ma_cross' | 'macd_signal' | 'rsi_reversal'
  parameters: Record<string, number>
  start_date: string
  end_date: string
  initial_capital: number
}

export async function runBacktest(payload: BacktestRequest) {
  const resp = await client.post('/backtest/run', payload)
  return resp.data?.data
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
  ohlcv_live_symbols?: number
  ohlcv_local_fallback_symbols?: number
}

export type BacktestLabResponse = {
  data: BacktestLabRow[]
  meta: BacktestLabMeta
}

export async function runBacktestLab(payload: BacktestLabRequest) {
  const resp = await client.post('/backtest/lab', payload)
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as BacktestLabResponse
}
