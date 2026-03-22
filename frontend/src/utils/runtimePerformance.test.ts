import { describe, expect, it } from 'vitest'

import {
  getFrontendPerformanceSnapshot,
  recordFrontendMetric,
  resetFrontendPerformanceMetrics,
} from './runtimePerformance'

describe('runtimePerformance', () => {
  it('aggregates metrics and retains slow events', () => {
    resetFrontendPerformanceMetrics()

    recordFrontendMetric('market.summary.load', 180, { category: 'network' })
    recordFrontendMetric('market.summary.load', 1500, { category: 'network', status: 'error' })
    recordFrontendMetric('chart.kline.render', 240, { category: 'render' })

    const snapshot = getFrontendPerformanceSnapshot()
    const summary = snapshot.metrics.find((item) => item.key === 'market.summary.load')
    const render = snapshot.metrics.find((item) => item.key === 'chart.kline.render')

    expect(summary?.count).toBe(2)
    expect(summary?.error_count).toBe(1)
    expect(summary?.avg_duration_ms).toBe(840)
    expect(render?.max_duration_ms).toBe(240)
    expect(snapshot.slow_events.length).toBe(2)
  })
})
