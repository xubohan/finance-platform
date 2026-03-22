import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import RuntimeModePanel from './RuntimeModePanel'

describe('RuntimeModePanel', () => {
  it('renders observability summary and failing routes', () => {
    render(
      <RuntimeModePanel
        health={{ status: 'ok', research_apis: false, ai_api: false }}
        error={null}
        observability={{
          uptime_sec: 240,
          http: {
            total_requests: 12,
            slow_request_threshold_ms: 1500,
            status_buckets: { '2xx': 10, '4xx': 1, '5xx': 1 },
            routes: [],
            slow_routes: [
              { method: 'GET', path: '/api/v1/market/{symbol}/summary', total: 3, avg_duration_ms: 1450, max_duration_ms: 2200, last_duration_ms: 2200, slow_requests: 1, slow_rate_pct: 33.3, last_status: 200, status_breakdown: { '200': 3 } },
            ],
            failing_routes: [
              { method: 'GET', path: '/api/v1/market/{symbol}/quote', status_code: 502, count: 2 },
            ],
          },
          market: {
            quotes: {
              crypto: { live_hit_rate_pct: 80, fallback_rate_pct: 20 },
              stock: { local_hit_rate_pct: 60, sync_hit_rate_pct: 30 },
            },
            sync: { success_rate_pct: 50 },
            movers: {
              stock: { success_rate_pct: 100 },
              crypto: { success_rate_pct: 75 },
            },
          },
          counters: {
            'market.quote.crypto.live_success': 4,
            'market.quote.crypto.cache_fallback': 1,
            'market.sync.success': 2,
            'market.quote.stock.local_success': 3,
          },
        }}
        observabilityError={null}
        frontendPerformance={{
          totals: { tracked_metrics: 4, total_events: 8, slow_event_count: 2 },
          metrics: [
            {
              key: 'market.summary.load',
              label: '工作台摘要刷新',
              category: 'network',
              count: 2,
              success_count: 2,
              error_count: 0,
              avg_duration_ms: 210,
              max_duration_ms: 280,
              last_duration_ms: 180,
              last_status: 'success',
              last_seen_at: '2026-03-14T00:00:00Z',
            },
            {
              key: 'market.kline.load',
              label: 'K 线数据刷新',
              category: 'network',
              count: 2,
              success_count: 2,
              error_count: 0,
              avg_duration_ms: 320,
              max_duration_ms: 410,
              last_duration_ms: 330,
              last_status: 'success',
              last_seen_at: '2026-03-14T00:00:01Z',
            },
            {
              key: 'backtest.run',
              label: '回测执行',
              category: 'interaction',
              count: 1,
              success_count: 1,
              error_count: 0,
              avg_duration_ms: 980,
              max_duration_ms: 980,
              last_duration_ms: 980,
              last_status: 'success',
              last_seen_at: '2026-03-14T00:00:02Z',
            },
            {
              key: 'chart.kline.render',
              label: 'K 线重绘',
              category: 'render',
              count: 3,
              success_count: 3,
              error_count: 0,
              avg_duration_ms: 44,
              max_duration_ms: 90,
              last_duration_ms: 30,
              last_status: 'success',
              last_seen_at: '2026-03-14T00:00:03Z',
            },
          ],
          slow_events: [
            {
              key: 'backtest.run',
              label: '回测执行',
              category: 'interaction',
              duration_ms: 980,
              status: 'success',
              recorded_at: '2026-03-14T00:00:02Z',
            },
          ],
        }}
        cacheMaintenance={{
          market_snapshot_daily: {
            total_rows: 1200,
            purgeable_rows: 120,
            retention_days: 45,
          },
          backtest_cache: {
            total_rows: 40,
            expired_rows: 7,
          },
        }}
        cacheMaintenanceError={null}
      />
    )

    expect(screen.getByText('请求总数')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Stock Local 命中率')).toBeInTheDocument()
    expect(screen.getByText('60.00%')).toBeInTheDocument()
    expect(screen.getByText('摘要刷新 / K 线刷新')).toBeInTheDocument()
    expect(screen.getByText('210 ms / 320 ms')).toBeInTheDocument()
    expect(screen.getByText('回测执行')).toBeInTheDocument()
    expect(screen.getByText('980 ms')).toBeInTheDocument()
    expect(screen.getByText('Snapshot 总行数 / 待清理')).toBeInTheDocument()
    expect(screen.getByText('1,200 / 120')).toBeInTheDocument()
    expect(screen.getByText('40 / 7')).toBeInTheDocument()
    expect(screen.getByText('GET /api/v1/market/{symbol}/summary')).toBeInTheDocument()
    expect(screen.getByText('2,200 ms')).toBeInTheDocument()
    expect(screen.getByText('GET /api/v1/market/{symbol}/quote')).toBeInTheDocument()
    expect(screen.getByText('502 x 2')).toBeInTheDocument()
  })
})
