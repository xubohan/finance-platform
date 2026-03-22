import client from './client'

export type HealthResponse = {
  status?: string
  research_apis?: boolean
  ai_api?: boolean
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

export async function getHealth() {
  const resp = await client.get('/health')
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
