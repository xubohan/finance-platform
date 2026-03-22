import type { CacheMaintenanceResponse, HealthResponse, ObservabilityResponse } from '../../api/system'
import type { FrontendPerformanceSnapshot } from '../../utils/runtimePerformance'
import { displayLocaleNumber, displayPercent, displayText } from '../../utils/display'

type Props = {
  health: HealthResponse | null
  error: string | null
  observability: ObservabilityResponse | null
  observabilityError: string | null
  frontendPerformance: FrontendPerformanceSnapshot
  cacheMaintenance: CacheMaintenanceResponse | null
  cacheMaintenanceError: string | null
}

function counterValue(observability: ObservabilityResponse | null, name: string): number {
  return Number(observability?.counters?.[name] ?? 0)
}

function metricValue(snapshot: FrontendPerformanceSnapshot, key: string) {
  return snapshot.metrics.find((item) => item.key === key) ?? null
}

export default function RuntimeModePanel({
  health,
  error,
  observability,
  observabilityError,
  frontendPerformance,
  cacheMaintenance,
  cacheMaintenanceError,
}: Props) {
  const totalRequests = observability?.http?.total_requests ?? 0
  const statusBuckets = observability?.http?.status_buckets ?? {}
  const failingRoutes = observability?.http?.failing_routes ?? []
  const slowRoutes = observability?.http?.slow_routes ?? []
  const slowThresholdMs = observability?.http?.slow_request_threshold_ms ?? 0
  const stockQuote = observability?.market?.quotes?.stock
  const cryptoQuote = observability?.market?.quotes?.crypto
  const sync = observability?.market?.sync
  const stockMovers = observability?.market?.movers?.stock
  const cryptoMovers = observability?.market?.movers?.crypto
  const cacheFallbacks =
    counterValue(observability, 'market.quote.crypto.cache_fallback') +
    counterValue(observability, 'market.quote.crypto.stale_cache_fallback') +
    counterValue(observability, 'market.quote.crypto.ohlcv_fallback')
  const frontendSlowEvents = frontendPerformance.slow_events ?? []
  const snapshotMaintenance = cacheMaintenance?.market_snapshot_daily
  const backtestMaintenance = cacheMaintenance?.backtest_cache
  const summaryMetric = metricValue(frontendPerformance, 'market.summary.load')
  const klineMetric = metricValue(frontendPerformance, 'market.kline.load')
  const backtestMetric = metricValue(frontendPerformance, 'backtest.run')
  const chartMetric = metricValue(frontendPerformance, 'chart.kline.render')

  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <h3>运行模式</h3>
        <span>确认当前是否处于 core-only 模式</span>
      </div>
      {error ? <p className="warn-text">{error}</p> : null}
      <div className="status-grid compact-status-grid">
        <div className="status-row">
          <span>API 状态</span>
          <strong>{displayText(health?.status)}</strong>
        </div>
        <div className="status-row">
          <span>Research APIs</span>
          <strong>{health?.research_apis ? 'enabled' : 'disabled'}</strong>
        </div>
        <div className="status-row">
          <span>AI API</span>
          <strong>{health?.ai_api ? 'enabled' : 'disabled'}</strong>
        </div>
      </div>
      <div className="runtime-note-block">
        <p className="panel-copy runtime-section-title">运行观测</p>
        {observabilityError ? <p className="warn-text">{observabilityError}</p> : null}
        <div className="status-grid compact-status-grid">
          <div className="status-row">
            <span>请求总数</span>
            <strong>{displayLocaleNumber(totalRequests)}</strong>
          </div>
          <div className="status-row">
            <span>4xx / 5xx</span>
            <strong>
              {displayLocaleNumber(statusBuckets['4xx'] ?? 0)} / {displayLocaleNumber(statusBuckets['5xx'] ?? 0)}
            </strong>
          </div>
          <div className="status-row">
            <span>慢请求阈值</span>
            <strong>{displayLocaleNumber(slowThresholdMs)} ms</strong>
          </div>
          <div className="status-row">
            <span>Crypto Live 命中</span>
            <strong>{displayLocaleNumber(counterValue(observability, 'market.quote.crypto.live_success'))}</strong>
          </div>
          <div className="status-row">
            <span>Quote 回退次数</span>
            <strong>{displayLocaleNumber(cacheFallbacks)}</strong>
          </div>
          <div className="status-row">
            <span>手动同步成功</span>
            <strong>{displayLocaleNumber(counterValue(observability, 'market.sync.success'))}</strong>
          </div>
          <div className="status-row">
            <span>Stock Local 命中</span>
            <strong>{displayLocaleNumber(counterValue(observability, 'market.quote.stock.local_success'))}</strong>
          </div>
        </div>
        <div className="runtime-note-block">
          <p className="panel-copy runtime-section-title">命中率摘要</p>
          <div className="status-grid compact-status-grid">
            <div className="status-row">
              <span>Stock Local 命中率</span>
              <strong>{displayPercent(stockQuote?.local_hit_rate_pct, 2)}</strong>
            </div>
            <div className="status-row">
              <span>Stock Sync 补齐率</span>
              <strong>{displayPercent(stockQuote?.sync_hit_rate_pct, 2)}</strong>
            </div>
            <div className="status-row">
              <span>Crypto Live 命中率</span>
              <strong>{displayPercent(cryptoQuote?.live_hit_rate_pct, 2)}</strong>
            </div>
            <div className="status-row">
              <span>Crypto Fallback 占比</span>
              <strong>{displayPercent(cryptoQuote?.fallback_rate_pct, 2)}</strong>
            </div>
            <div className="status-row">
              <span>手动同步成功率</span>
              <strong>{displayPercent(sync?.success_rate_pct, 2)}</strong>
            </div>
            <div className="status-row">
              <span>Movers 成功率</span>
              <strong>
                {displayPercent(stockMovers?.success_rate_pct, 2)} / {displayPercent(cryptoMovers?.success_rate_pct, 2)}
              </strong>
            </div>
          </div>
        </div>
        <div className="runtime-note-block">
          <p className="panel-copy runtime-section-title">慢接口</p>
          {slowRoutes.length === 0 ? (
            <p className="empty-hint">当前没有记录到超过阈值的热点慢接口。</p>
          ) : (
            <div className="runtime-observation-list">
              {slowRoutes.slice(0, 3).map((item) => (
                <div key={`${item.method}-${item.path}-slow`} className="runtime-observation-row">
                  <span>{item.method} {item.path}</span>
                  <strong>{displayLocaleNumber(item.max_duration_ms)} ms</strong>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="runtime-note-block">
          <p className="panel-copy runtime-section-title">前端性能</p>
          <div className="status-grid compact-status-grid">
            <div className="status-row">
              <span>摘要刷新 / K 线刷新</span>
              <strong>
                {displayLocaleNumber(summaryMetric?.avg_duration_ms)} ms / {displayLocaleNumber(klineMetric?.avg_duration_ms)} ms
              </strong>
            </div>
            <div className="status-row">
              <span>回测执行 / K 线重绘</span>
              <strong>
                {displayLocaleNumber(backtestMetric?.avg_duration_ms)} ms / {displayLocaleNumber(chartMetric?.avg_duration_ms)} ms
              </strong>
            </div>
            <div className="status-row">
              <span>前端慢事件数</span>
              <strong>{displayLocaleNumber(frontendPerformance.totals.slow_event_count)}</strong>
            </div>
          </div>
          {frontendSlowEvents.length === 0 ? (
            <p className="empty-hint">当前没有记录到前端慢事件。</p>
          ) : (
            <div className="runtime-observation-list">
              {frontendSlowEvents.slice(0, 4).map((item) => (
                <div key={`${item.key}-${item.recorded_at}`} className="runtime-observation-row">
                  <span>{item.label}</span>
                  <strong>{displayLocaleNumber(item.duration_ms)} ms</strong>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="runtime-note-block">
          <p className="panel-copy runtime-section-title">缓存维护</p>
          {cacheMaintenanceError ? <p className="warn-text">{cacheMaintenanceError}</p> : null}
          <div className="status-grid compact-status-grid">
            <div className="status-row">
              <span>Snapshot 总行数 / 待清理</span>
              <strong>
                {displayLocaleNumber(snapshotMaintenance?.total_rows)} / {displayLocaleNumber(snapshotMaintenance?.purgeable_rows)}
              </strong>
            </div>
            <div className="status-row">
              <span>Backtest Cache 总行数 / 已过期</span>
              <strong>
                {displayLocaleNumber(backtestMaintenance?.total_rows)} / {displayLocaleNumber(backtestMaintenance?.expired_rows)}
              </strong>
            </div>
            <div className="status-row">
              <span>Snapshot 保留天数</span>
              <strong>{displayLocaleNumber(snapshotMaintenance?.retention_days)}</strong>
            </div>
          </div>
        </div>
        <div className="runtime-note-block">
          <p className="panel-copy runtime-section-title">热点错误</p>
          {failingRoutes.length === 0 ? (
            <p className="empty-hint">当前没有记录到 4xx / 5xx 热点接口。</p>
          ) : (
            <div className="runtime-observation-list">
              {failingRoutes.slice(0, 4).map((item) => (
                <div key={`${item.method}-${item.path}-${item.status_code}`} className="runtime-observation-row">
                  <span>{item.method} {item.path}</span>
                  <strong>{item.status_code} x {item.count}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
