import client from './client'

export type ScreenerMarketType = 'america' | 'china'
export type ScreenerApiMarket = 'us' | 'cn'
export type ScreenerFilterField = 'pe_ttm' | 'roe' | 'profit_yoy'
export type ScreenerFilterOperator = 'gte' | 'lte'

export type ScreenerFilter = {
  field: ScreenerFilterField
  operator: ScreenerFilterOperator
  value: number | null
}

export type ScreenerSymbol = {
  symbol: string
  name: string
  asset_type: 'stock'
  market?: string | null
}

export type ScreenerSymbolsResponse = {
  data: ScreenerSymbol[]
  meta?: {
    count?: number
    market?: ScreenerMarketType
    total_available?: number
    source?: string
    stale?: boolean
    as_of?: string | null
    cache_age_sec?: number | null
    refresh_in_progress?: boolean
  }
}

export type ScreenerRow = {
  symbol: string
  name: string
  market?: string | null
  last_price?: number | null
  change_pct?: number | null
  volume?: number | null
  pe_ttm?: number | null
  pb?: number | null
  roe?: number | null
  profit_yoy?: number | null
  market_cap?: number | null
}

export type ScreenerResponseMeta = {
  count?: number
  total_items?: number
  total_pages?: number
  page?: number
  page_size?: number
  market?: ScreenerMarketType
  refresh_latest?: boolean
  symbols_fetched?: number
  fundamentals_upserted?: number
  total_available?: number
  source?: string
  stale?: boolean
  as_of?: string | null
  cache_age_sec?: number | null
  refresh_in_progress?: boolean
}

export type RunScreenerPayload = {
  market: ScreenerMarketType | ScreenerApiMarket | string
  filters: ScreenerFilter[]
  page?: number
  page_size?: number
  symbol_limit?: number
  force_refresh?: boolean
  allow_stale?: boolean
}

export type RunScreenerResponse = {
  data: ScreenerRow[]
  meta?: ScreenerResponseMeta
}

function normalizeMarket(market: string): ScreenerApiMarket {
  const normalized = market.trim().toLowerCase()
  if (normalized === 'america' || normalized === 'us') return 'us'
  if (normalized === 'china' || normalized === 'cn') return 'cn'
  throw new Error(`Unsupported screener market: ${market}`)
}

function toFrontendMarket(market: string | null | undefined): ScreenerMarketType {
  return normalizeMarket(market ?? 'us') === 'cn' ? 'china' : 'america'
}

function sanitizeNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function mapFilterPayload(filters: ScreenerFilter[]) {
  return filters.reduce<Record<string, number>>((payload, filter) => {
    const value = sanitizeNumber(filter.value)
    if (value === null) return payload

    if (filter.field === 'pe_ttm') {
      payload[filter.operator === 'gte' ? 'min_pe' : 'max_pe'] = value
      return payload
    }
    if (filter.field === 'roe') {
      payload.min_roe = value
      return payload
    }
    if (filter.field === 'profit_yoy') {
      payload.min_profit_yoy = value
      return payload
    }
    return payload
  }, {})
}

export async function getSymbols(options: {
  market?: ScreenerMarketType | ScreenerApiMarket | string
  limit?: number
  force_refresh?: boolean
  allow_stale?: boolean
} = {}) {
  const {
    market = 'america',
    limit = 80,
    force_refresh = false,
    allow_stale = true,
  } = options

  const apiMarket = normalizeMarket(market)
  const resp = await client.get('/screener/symbols', {
    params: {
      market: apiMarket,
      limit,
      force_refresh,
      allow_stale,
    },
  })

  return {
    data: Array.isArray(resp.data?.data)
      ? resp.data.data.map((row: Partial<ScreenerSymbol>) => ({
          symbol: typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : '',
          name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : (typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : ''),
          asset_type: 'stock' as const,
          market: typeof row.market === 'string' ? row.market.trim().toUpperCase() : null,
        }))
      : [],
    meta: {
      ...(resp.data?.meta ?? {}),
      market: toFrontendMarket(resp.data?.meta?.market),
    },
  } as ScreenerSymbolsResponse
}

export async function runScreener(payload: RunScreenerPayload) {
  const apiMarket = normalizeMarket(payload.market)
  const resp = await client.post('/screener/run', {
    market: apiMarket,
    page: payload.page ?? 1,
    page_size: payload.page_size ?? 50,
    symbol_limit: payload.symbol_limit ?? 20000,
    force_refresh: payload.force_refresh ?? true,
    allow_stale: payload.allow_stale ?? false,
    ...mapFilterPayload(payload.filters),
  })

  return {
    data: Array.isArray(resp.data?.data)
      ? resp.data.data.map((row: Partial<ScreenerRow>) => ({
          symbol: typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : '',
          name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : (typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : ''),
          market: typeof row.market === 'string' ? row.market.trim().toUpperCase() : null,
          last_price: sanitizeNumber(row.last_price),
          change_pct: sanitizeNumber(row.change_pct),
          volume: sanitizeNumber(row.volume),
          pe_ttm: sanitizeNumber(row.pe_ttm),
          pb: sanitizeNumber(row.pb),
          roe: sanitizeNumber(row.roe),
          profit_yoy: sanitizeNumber(row.profit_yoy),
          market_cap: sanitizeNumber(row.market_cap),
        }))
      : [],
    meta: {
      ...(resp.data?.meta ?? {}),
      market: toFrontendMarket(resp.data?.meta?.market),
    },
  } as RunScreenerResponse
}
