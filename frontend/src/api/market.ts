import type { Time } from 'lightweight-charts'

import client from './client'

export type MarketPeriod = '1d' | '1W' | '1M'
export type AssetType = 'stock' | 'crypto'
export type SearchAssetType = AssetType | 'all'

export type QuoteData = {
  symbol: string
  asset_type: AssetType
  price: number
  change_pct_24h: number
  source?: 'cache' | 'live' | 'mixed' | 'local'
  as_of?: string | null
}

export type QuoteResponse = {
  data: QuoteData
  meta?: {
    source?: 'cache' | 'live' | 'mixed' | 'local'
    stale?: boolean
    as_of?: string | null
    provider?: string
    fetch_source?: string
    sync_performed?: boolean
    coverage_complete?: boolean
  }
}

export type BatchQuoteRow = {
  symbol: string
  asset_type: AssetType
  price?: number | null
  change_pct_24h?: number | null
  as_of?: string | null
  source?: 'cache' | 'live' | 'mixed' | 'local' | null
  fetch_source?: string | null
  stale?: boolean | null
  error?: string | null
}

export type BatchQuoteResponse = {
  data: BatchQuoteRow[]
  meta?: {
    count?: number
    success_count?: number
    failed_count?: number
    failed_symbols?: string[]
  }
}

export type KlinePoint = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type KlineResponse = {
  data: KlinePoint[]
  meta?: {
    symbol?: string
    period?: MarketPeriod
    asset_type?: AssetType
    source?: 'cache' | 'live' | 'mixed' | 'local'
    stale?: boolean
    as_of?: string | null
    provider?: string
    fetch_source?: string
    sync_performed?: boolean
    coverage_complete?: boolean
    count?: number
    start?: string
    end?: string
  }
}

export type SearchAsset = {
  symbol: string
  name: string
  asset_type: AssetType
  market?: string | null
}

export type SearchResponse = {
  data: SearchAsset[]
  meta?: {
    count?: number
  }
}

export type TopMoverRow = {
  symbol: string
  change_pct: number
  latest: number
}

export type TopMoversMeta = {
  count?: number
  type?: 'stock' | 'crypto'
  source?: 'cache' | 'live' | 'mixed'
  stale?: boolean
  as_of?: string | null
  cache_age_sec?: number | null
}

export type TopMoversResponse = {
  data: TopMoverRow[]
  meta?: TopMoversMeta
}

export type HistoryStatusData = {
  symbol: string
  asset_type: AssetType
  local_rows: number
  local_start?: string | null
  local_end?: string | null
  has_data: boolean
}

export type MarketSummaryResponse = {
  data: {
    symbol: string
    asset_type: AssetType
    quote: QuoteData | null
    history_status: HistoryStatusData | null
  }
  meta?: {
    quote?: QuoteResponse['meta']
    history_status?: {
      count?: number
      symbol?: string
      asset_type?: AssetType
    }
    quote_error?: string | null
  }
}

export type SyncHistoryResponse = {
  data: {
    symbol: string
    asset_type: AssetType
    rows_synced: number
    requested_start: string
    requested_end: string
    local_rows: number
    local_start?: string | null
    local_end?: string | null
  } | null
  meta?: {
    source?: 'cache' | 'live' | 'mixed'
    stale?: boolean
    as_of?: string | null
    provider?: string
    fetch_source?: string
  }
}

export async function getMarketSummary(symbol: string) {
  const resp = await client.get(`/market/${encodeURIComponent(symbol)}/summary`)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as MarketSummaryResponse
}

export async function getBatchQuotes(symbols: string[]) {
  const resp = await client.post('/market/quotes', { symbols })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as BatchQuoteResponse
}

export async function getKline(symbol: string, period: MarketPeriod, start?: string, end?: string) {
  const resp = await client.get(`/market/${encodeURIComponent(symbol)}/kline`, {
    params: { period, start, end },
  })
  return (resp.data ?? {}) as KlineResponse
}

export async function searchAssets(query: string, type: SearchAssetType = 'all', limit = 8) {
  const resp = await client.get('/market/search', {
    params: {
      q: query,
      type,
      limit,
    },
  })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as SearchResponse
}

export async function getTopMovers(type: AssetType, limit = 6) {
  const resp = await client.get('/market/top-movers', {
    params: {
      type,
      limit,
    },
  })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as TopMoversResponse
}

export async function syncHistory(symbol: string, startDate: string, endDate: string) {
  const resp = await client.post(`/market/${encodeURIComponent(symbol)}/sync`, {
    start_date: startDate,
    end_date: endDate,
    period: '1d',
  })
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as SyncHistoryResponse
}

export function toCandles(points: KlinePoint[]) {
  return points
    .filter((p) => p.time)
    .map((p) => ({
      time: p.time.slice(0, 10) as Time,
      open: Number(p.open),
      high: Number(p.high),
      low: Number(p.low),
      close: Number(p.close),
    }))
}
