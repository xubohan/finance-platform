import type { Time, UTCTimestamp } from 'lightweight-charts'

import client from './client'

export type MarketPeriod = '1d' | '1W' | '1M'
export type MarketDetailPeriod = '1m' | '5m' | '1h' | MarketPeriod
export type AssetType = 'stock' | 'crypto'
export type SearchAssetType = AssetType | 'all'

export type QuoteData = {
  symbol: string
  asset_type: AssetType
  price: number
  change_pct_24h: number
  source?: 'cache' | 'live' | 'persisted' | 'delayed' | 'eod' | 'upstream'
  as_of?: string | null
}

export type QuoteResponse = {
  data: QuoteData
  meta?: {
    source?: 'cache' | 'live' | 'persisted' | 'delayed' | 'eod' | 'upstream'
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
  source?: 'cache' | 'live' | 'persisted' | null
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
    period?: MarketDetailPeriod
    requested_period?: MarketDetailPeriod
    resolved_period?: MarketDetailPeriod
    fallback_applied?: boolean
    asset_type?: AssetType
    source?: 'cache' | 'live' | 'persisted' | 'delayed' | 'eod' | 'upstream'
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
  market?: string
}

export type TopMoversMeta = {
  count?: number
  market?: 'us' | 'cn' | 'crypto' | 'all'
  direction?: 'gain' | 'loss'
  source?: 'cache' | 'live' | 'persisted' | 'delayed' | 'eod' | 'upstream'
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

export type FinancialRow = Record<string, string | number | null | boolean>
export type CnFlowRow = {
  trade_date: string
  rzye?: number | null
  rzmre?: number | null
  rqyl?: number | null
  rqmcl?: number | null
  rzrqye?: number | null
  super_large_net?: number | null
  large_net?: number | null
  medium_net?: number | null
  small_net?: number | null
  main_net?: number | null
  net_buy?: number | null
  buy_amount?: number | null
  sell_amount?: number | null
  hold_amount?: number | null
}

export type DragonTigerRow = {
  trade_date: string
  reason?: string | null
  net_buy?: number | null
  buy_amount?: number | null
  sell_amount?: number | null
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
    source?: 'cache' | 'live' | 'persisted'
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
  const resp = await client.post('/market/batch/quotes', { symbols })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as BatchQuoteResponse
}

export async function getKline(symbol: string, period: MarketDetailPeriod, start?: string, end?: string) {
  const resp = await client.get(`/market/${encodeURIComponent(symbol)}/kline`, {
    params: { period, start, end },
  })
  const rawMeta = resp.data?.meta ?? {}
  return {
    data: resp.data?.data ?? [],
    meta: {
      ...rawMeta,
      requested_period: period,
      resolved_period: (rawMeta.resolved_period ?? rawMeta.period ?? period) as MarketDetailPeriod,
      fallback_applied: rawMeta.fallback_applied === true,
    },
  } as KlineResponse
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
  const market = type === 'crypto' ? 'crypto' : 'us'
  return getMovers(market, limit)
}

export async function getMovers(
  market: 'us' | 'cn' | 'crypto' | 'all',
  limit = 6,
  direction: 'gain' | 'loss' = 'gain',
) {
  const resp = await client.get('/market/movers', {
    params: {
      market,
      direction,
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

export async function getFinancials(symbol: string, params?: {
  report_type?: 'income' | 'balance' | 'cashflow'
  period?: 'annual' | 'quarterly'
  limit?: number
}) {
  const resp = await client.get(`/market/${encodeURIComponent(symbol)}/financials`, { params })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: FinancialRow[]
    meta: {
      count?: number
      report_type?: 'income' | 'balance' | 'cashflow'
      period?: 'annual' | 'quarterly'
    }
  }
}

export async function getMargin(symbol: string) {
  const resp = await client.get(`/market/${encodeURIComponent(symbol)}/margin`)
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as { data: CnFlowRow[]; meta: { count?: number } }
}

export async function getBigOrderFlow(symbol: string) {
  const resp = await client.get(`/market/${encodeURIComponent(symbol)}/big-order`)
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as { data: CnFlowRow[]; meta: { count?: number } }
}

export async function getDragonTiger(symbol: string) {
  const resp = await client.get(`/market/${encodeURIComponent(symbol)}/dragon-tiger`)
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as { data: DragonTigerRow[]; meta: { count?: number } }
}

export async function getNorthbound(params?: { date?: string; market?: 'sh' | 'sz' | 'all' }) {
  const resp = await client.get('/market/northbound', { params })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: CnFlowRow[]
    meta: {
      count?: number
      market?: 'sh' | 'sz' | 'all'
      trade_date?: string | null
      source?: 'eod' | 'persisted' | 'live'
      stale?: boolean
      as_of?: string | null
      generated_at?: string | null
    }
  }
}

function mapPointTime(raw: string): Time {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw as Time
  }
  const normalized = raw.includes(' ') && !raw.includes('T') ? raw.replace(' ', 'T') : raw
  const epochMs = Date.parse(normalized)
  if (Number.isFinite(epochMs)) {
    return Math.floor(epochMs / 1000) as UTCTimestamp
  }
  return raw.slice(0, 10) as Time
}

export function toCandles(points: KlinePoint[]) {
  return points
    .filter((p) => p.time)
    .map((p) => ({
      time: mapPointTime(p.time),
      open: Number(p.open),
      high: Number(p.high),
      low: Number(p.low),
      close: Number(p.close),
    }))
}
