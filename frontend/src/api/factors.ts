import client from './client'

export type FactorWeights = {
  value: number
  growth: number
  momentum: number
  quality: number
}

export type FactorMarket = 'us' | 'cn'

export type FactorRow = {
  symbol: string
  name: string
  total_score: number
  value_score: number
  growth_score: number
  momentum_score: number
  quality_score: number
  pe_ttm?: number
  roe?: number
  profit_yoy?: number
  momentum_20d?: number
}

export type FactorMeta = {
  count: number
  total_items?: number
  total_pages?: number
  page?: number
  page_size?: number
  market: FactorMarket
  symbols_fetched?: number
  total_available?: number
  source?: 'cache' | 'live' | 'mixed'
  stale?: boolean
  as_of?: string | null
  cache_age_sec?: number | null
  refresh_in_progress?: boolean
}

export type FactorResponse = {
  data: FactorRow[]
  meta: FactorMeta
}

export async function scoreFactors(
  weights: FactorWeights,
  market: FactorMarket,
  page = 1,
  pageSize = 50,
  symbolLimit = 20000,
  forceRefresh = true,
  allowStale = false,
) {
  const resp = await client.post('/factors/score', {
    weights,
    market,
    page,
    page_size: pageSize,
    symbol_limit: symbolLimit,
    force_refresh: forceRefresh,
    allow_stale: allowStale,
  })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as FactorResponse
}
