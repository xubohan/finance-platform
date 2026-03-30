import client from './client'

export type SectorHeatmapRow = {
  sector: string
  count: number
  avg_change_pct: number
  median_change_pct: number
  advancers: number
  decliners: number
  flat: number
  total_market_cap: number
  heat_score: number
}

export type CorrelationMatrixRow = {
  symbol: string
  correlations: Record<string, number>
}

export type CnFlowHeatmapRow = {
  symbol: string
  display_name?: string | null
  entity_type?: 'symbol' | 'sector' | null
  leader_symbol?: string | null
  trade_date?: string | null
  as_of?: string | null
  change_pct?: number | null
  main_net?: number | null
  super_large_net?: number | null
  large_net?: number | null
  medium_net?: number | null
  small_net?: number | null
}

export async function analyzeSentiment(payload: {
  text: string
  context_symbols: string[]
}) {
  const resp = await client.post('/analysis/sentiment', payload)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  }
}

export async function analyzeEventImpact(payload: {
  event_text: string
  event_type: string
  symbols: string[]
  window_days: number
}) {
  const resp = await client.post('/analysis/event-impact', payload)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as { data: { task_id?: string } | null; meta: { accepted_at?: string } }
}

export async function getAnalysisTask(taskId: string) {
  const resp = await client.get(`/analysis/tasks/${encodeURIComponent(taskId)}`)
  return (resp.data ?? {}) as {
    status: string
    task_id?: string
    error?: string
    result?: {
      data?: {
        sentiment_score?: number
        sentiment_label?: string
        llm_analysis?: {
          summary?: string
          key_factors?: string[]
          risk_factors?: string[]
          impact_assessment?: string
        }
        historical_context?: {
          similar_events_found?: number
          event_type?: string
          sample_description?: string
          average_return_5d?: number
          win_rate_5d?: number
        }
        symbol_predictions?: Array<{
          symbol: string
          predicted_direction?: string
          confidence?: number
          basis?: string
          sample_size?: number
          historical_win_rate_5d?: number
          historical_avg_return_5d?: number
          historical_avg_return_20d?: number
          avg_vol_ratio_1d?: number | null
          return_distribution?: {
            p10?: number
            p25?: number
            p50?: number
            p75?: number
            p90?: number
          }
        }>
      }
      meta?: {
        task_id?: string
        model_used?: string
        degraded?: boolean
        degraded_reason?: string | null
      }
    }
  }
}

export async function getSectorHeatmap(market: 'us' | 'cn' = 'us') {
  const resp = await client.get('/analysis/sector-heatmap', {
    params: { market },
  })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: SectorHeatmapRow[]
    meta: {
      market?: 'us' | 'cn'
      count?: number
      symbols_considered?: number
      source?: string
      stale?: boolean
      as_of?: string | null
      cache_age_sec?: number | null
      grouping?: string
    }
  }
}

export async function getCorrelation(params: {
  symbols: string[]
  period?: `${number}d`
}) {
  const resp = await client.get('/analysis/correlation', {
    params: {
      symbols: params.symbols.join(','),
      period: params.period ?? '90d',
    },
  })
  return {
    data: resp.data?.data ?? { symbols: [], matrix: [] },
    meta: resp.data?.meta ?? {},
  } as {
    data: {
      symbols: string[]
      matrix: CorrelationMatrixRow[]
    }
    meta: {
      period?: `${number}d`
      rows?: number
    }
  }
}

export async function getCnFlowHeatmap() {
  const resp = await client.get('/analysis/cn-flow-heatmap')
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: CnFlowHeatmapRow[]
    meta: {
      count?: number
      source?: string
      stale?: boolean
      as_of?: string | null
      entity_type?: 'symbol' | 'sector'
      generated_at?: string
    }
  }
}
