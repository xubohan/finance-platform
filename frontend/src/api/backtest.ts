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
