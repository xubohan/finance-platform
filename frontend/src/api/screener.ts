import client from './client'

export type ScreenerMarket = 'us' | 'cn'

export type ScreenerParams = {
  min_pe?: number
  max_pe?: number
  min_roe?: number
  min_profit_yoy?: number
  market?: ScreenerMarket
  symbol_limit?: number
  page?: number
  page_size?: number
  force_refresh?: boolean
  allow_stale?: boolean
}

export type ScreenerMeta = {
  count: number
  market: ScreenerMarket
  total_available?: number
  symbols_fetched?: number
  fundamentals_upserted?: number
  total_items?: number
  total_pages?: number
  page?: number
  page_size?: number
  source?: 'cache' | 'live' | 'mixed'
  stale?: boolean
  as_of?: string | null
  cache_age_sec?: number | null
  refresh_in_progress?: boolean
}

export type ScreenerRow = {
  symbol: string
  name: string
  market?: string
  pe_ttm?: number
  roe?: number
  profit_yoy?: number
}

export type ScreenerResponse = {
  data: ScreenerRow[]
  meta: ScreenerMeta
}

export async function runScreener(params: ScreenerParams) {
  const resp = await client.post('/screener/run', params)
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as ScreenerResponse
}

export async function getScreenerSymbols(
  market: ScreenerMarket,
  limit = 30,
  forceRefresh = false,
  allowStale = true,
) {
  const resp = await client.get('/screener/symbols', {
    params: { market, limit, force_refresh: forceRefresh, allow_stale: allowStale },
  })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as ScreenerResponse
}
