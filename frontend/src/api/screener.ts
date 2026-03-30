import client from './client'

export type ScreenerSymbolRow = {
  symbol: string
  name: string
  market?: string
}

export type ScreenerRunRequest = {
  market: 'us' | 'cn'
  min_pe?: number
  max_pe?: number
  min_roe?: number
  min_profit_yoy?: number
  symbol_limit?: number
  page?: number
  page_size?: number
}

export type ScreenerRow = {
  symbol: string
  name: string
  market: string
  pe_ttm?: number | null
  pb?: number | null
  roe?: number | null
  profit_yoy?: number | null
  market_cap?: number | null
}

export async function getScreenerSymbols(params: {
  market: 'us' | 'cn'
  limit?: number
}) {
  const resp = await client.get('/screener/symbols', { params })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: ScreenerSymbolRow[]
    meta: {
      count?: number
      total_available?: number
      source?: string
      stale?: boolean
      as_of?: string | null
    }
  }
}

export async function runScreener(payload: ScreenerRunRequest) {
  const resp = await client.post('/screener/run', {
    force_refresh: true,
    allow_stale: false,
    symbol_limit: 200,
    page_size: 50,
    page: 1,
    ...payload,
  })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: ScreenerRow[]
    meta: {
      count?: number
      total_items?: number
      total_pages?: number
      page?: number
      page_size?: number
      market?: 'us' | 'cn'
      total_available?: number
      source?: string
      stale?: boolean
      as_of?: string | null
    }
  }
}
