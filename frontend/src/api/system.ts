import client from './client'

export type HealthResponse = {
  status?: string
  version?: string
  features?: {
    research_apis?: boolean
    ai_api?: boolean
    llm_analysis?: boolean
    news_fetch?: boolean
    cn_data?: boolean
  }
}

export type ObservabilityRoute = {
  method: string
  path: string
  total: number
  avg_duration_ms: number
  max_duration_ms: number
  last_duration_ms: number
  last_status: number
  last_seen_at?: string | null
  status_breakdown: Record<string, number>
}

export type ObservabilityFailure = {
  method: string
  path: string
  status_code: number
  count: number
  last_seen_at?: string | null
}

export type ObservabilityMarketChannel = {
  total?: number
  success?: number
  failure?: number
  success_rate_pct?: number
}

export type ObservabilityQuoteChannel = {
  total?: number
  live_success?: number
  cache_fallback?: number
  stale_cache_fallback?: number
  ohlcv_fallback?: number
  local_success?: number
  synced_success?: number
  failures?: number
  live_hit_rate_pct?: number
  fallback_rate_pct?: number
  local_hit_rate_pct?: number
  sync_hit_rate_pct?: number
}

export type CacheMaintenanceSummary = {
  retention_days?: number
  cutoff_date?: string | null
  total_rows?: number
  purgeable_rows?: number
  oldest_trade_date?: string | null
  newest_trade_date?: string | null
  expired_rows?: number
  oldest_created_at?: string | null
  newest_created_at?: string | null
  oldest_expires_at?: string | null
  newest_expires_at?: string | null
}

export type ObservabilityResponse = {
  uptime_sec?: number
  http?: {
    total_requests?: number
    slow_request_threshold_ms?: number
    status_buckets?: Record<string, number>
    status_totals?: Record<string, number>
    routes?: ObservabilityRoute[]
    failing_routes?: ObservabilityFailure[]
    slow_routes?: ObservabilityRoute[]
  }
  market?: {
    quotes?: {
      crypto?: ObservabilityQuoteChannel
      stock?: ObservabilityQuoteChannel
    }
    sync?: ObservabilityMarketChannel
    movers?: {
      stock?: ObservabilityMarketChannel
      crypto?: ObservabilityMarketChannel
    }
  }
  counters?: Record<string, number>
}

export type CacheMaintenanceResponse = {
  market_snapshot_daily?: CacheMaintenanceSummary
  backtest_cache?: CacheMaintenanceSummary
}

export type CacheCleanupResponse = {
  dry_run?: boolean
  deleted_rows?: Record<string, number>
  cutoff_date?: string | null
}

export type DataStatusSampleQuote = {
  symbol?: string
  asset_type?: string
  status?: string
  error?: string | null
  source?: string | null
  provider?: string | null
  fetch_source?: string | null
  stale?: boolean | null
  as_of?: string | null
  price?: number | null
  change_pct_24h?: number | null
}

export type DataStatusDatasets = {
  status?: string
  news_items_total?: number
  news_items_last_24h?: number
  latest_news_at?: string | null
  market_events_total?: number
  upcoming_events_30d?: number
  latest_event_at?: string | null
  watchlist_items_total?: number
}

export type DataStatusResponse = {
  data: {
    provider_health?: {
      summary?: {
        status?: string
        total_checks?: number
        ok_checks?: number
        degraded_checks?: number
        error_checks?: number
        generated_at?: string
      }
      checks?: Array<{
        name?: string
        status?: string
        checked_at?: string
        latency_ms?: number
        details?: {
          source?: string | null
          provider?: string | null
          stale?: boolean | null
          as_of?: string | null
        }
      }>
    }
    llm?: {
      configured?: boolean
      model?: string
      api_style?: string
      base_url?: string
      endpoint_path?: string
      reasoning_effort?: string
    }
    feature_flags?: {
      enable_news_fetch?: boolean
      enable_cn_data?: boolean
      enable_llm_analysis?: boolean
    }
    stock_quote_aapl?: DataStatusSampleQuote
    crypto_quote_btc?: DataStatusSampleQuote
    datasets?: DataStatusDatasets
  }
  meta?: {
    generated_at?: string
    served_from_cache?: boolean
    cache_ttl_sec?: number
  }
}

export async function getHealth() {
  const resp = await client.get('/system/health')
  return (resp.data ?? {}) as HealthResponse
}

export async function getObservability() {
  const resp = await client.get('/system/observability')
  return (resp.data?.data ?? {}) as ObservabilityResponse
}

export async function getCacheMaintenance() {
  const resp = await client.get('/system/cache-maintenance')
  return (resp.data?.data ?? {}) as CacheMaintenanceResponse
}

export async function cleanupCacheMaintenance(dryRun = true) {
  const resp = await client.post('/system/cache-maintenance/cleanup', null, {
    params: { dry_run: dryRun },
  })
  return {
    data: (resp.data?.data ?? {}) as CacheCleanupResponse,
    meta: resp.data?.meta ?? {},
  }
}

export async function getDataStatus(forceRefresh = false) {
  const resp = await client.get('/system/data-status', {
    params: forceRefresh ? { force_refresh: true } : undefined,
  })
  return {
    data: resp.data?.data ?? {},
    meta: resp.data?.meta ?? {},
  } as DataStatusResponse
}
