import client from './client'

export type ScreenerMarket = 'us' | 'cn' | 'all'

export type ScreenerParams = {
  min_pe?: number
  max_pe?: number
  min_roe?: number
  min_profit_yoy?: number
  market?: ScreenerMarket
  refresh_latest?: boolean
  symbol_limit?: number
  limit?: number
}

export async function runScreener(params: ScreenerParams) {
  const resp = await client.post('/screener/run', params)
  return resp.data?.data ?? []
}

export async function getScreenerSymbols(market: ScreenerMarket, limit = 30) {
  const resp = await client.get('/screener/symbols', { params: { market, limit } })
  return resp.data?.data ?? []
}
