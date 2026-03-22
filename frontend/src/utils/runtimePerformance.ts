type MetricCategory = 'network' | 'render' | 'interaction'
type MetricStatus = 'success' | 'error'

export type FrontendMetricSummary = {
  key: string
  label: string
  category: MetricCategory
  count: number
  success_count: number
  error_count: number
  avg_duration_ms: number
  max_duration_ms: number
  last_duration_ms: number
  last_status: MetricStatus | null
  last_seen_at: string | null
}

export type FrontendSlowEvent = {
  key: string
  label: string
  category: MetricCategory
  duration_ms: number
  status: MetricStatus
  recorded_at: string
}

export type FrontendPerformanceSnapshot = {
  totals: {
    tracked_metrics: number
    total_events: number
    slow_event_count: number
  }
  metrics: FrontendMetricSummary[]
  slow_events: FrontendSlowEvent[]
}

type MetricState = {
  label: string
  category: MetricCategory
  count: number
  success_count: number
  error_count: number
  total_duration_ms: number
  max_duration_ms: number
  last_duration_ms: number
  last_status: MetricStatus | null
  last_seen_at: string | null
}

type RecordOptions = {
  category?: MetricCategory
  status?: MetricStatus
  label?: string
}

const CATEGORY_THRESHOLDS: Record<MetricCategory, number> = {
  network: 1200,
  render: 180,
  interaction: 450,
}

const LABELS: Record<string, string> = {
  'workspace.search': '标的搜索',
  'workspace.movers': '动量列表刷新',
  'workspace.runtimeState': '运行面板刷新',
  'market.summary.load': '工作台摘要刷新',
  'market.kline.load': 'K 线数据刷新',
  'market.history.sync': '本地历史同步',
  'backtest.run': '回测执行',
  'chart.kline.render': 'K 线重绘',
  'chart.kline.init': 'K 线初始化',
  'chart.equity.render': '权益曲线重绘',
  'chart.equity.init': '权益曲线初始化',
}

const ORDER: string[] = [
  'market.summary.load',
  'market.kline.load',
  'backtest.run',
  'chart.kline.render',
  'chart.equity.render',
  'workspace.search',
  'workspace.movers',
  'workspace.runtimeState',
  'market.history.sync',
  'chart.kline.init',
  'chart.equity.init',
]

let metrics = new Map<string, MetricState>()
let slowEvents: FrontendSlowEvent[] = []
const listeners = new Set<() => void>()
let snapshotCache: FrontendPerformanceSnapshot = {
  totals: {
    tracked_metrics: 0,
    total_events: 0,
    slow_event_count: 0,
  },
  metrics: [],
  slow_events: [],
}

function nowIso() {
  return new Date().toISOString()
}

function metricLabel(key: string, explicit?: string) {
  return explicit ?? LABELS[key] ?? key
}

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function sortedMetricEntries() {
  const rows = [...metrics.entries()].map(([key, state]) => {
    const avg = state.count > 0 ? state.total_duration_ms / state.count : 0
    return {
      key,
      label: state.label,
      category: state.category,
      count: state.count,
      success_count: state.success_count,
      error_count: state.error_count,
      avg_duration_ms: Number(avg.toFixed(2)),
      max_duration_ms: Number(state.max_duration_ms.toFixed(2)),
      last_duration_ms: Number(state.last_duration_ms.toFixed(2)),
      last_status: state.last_status,
      last_seen_at: state.last_seen_at,
    } satisfies FrontendMetricSummary
  })

  const orderIndex = new Map(ORDER.map((key, index) => [key, index]))
  rows.sort((left, right) => {
    const leftIndex = orderIndex.get(left.key) ?? Number.MAX_SAFE_INTEGER
    const rightIndex = orderIndex.get(right.key) ?? Number.MAX_SAFE_INTEGER
    if (leftIndex !== rightIndex) return leftIndex - rightIndex
    if (left.category !== right.category) return left.category.localeCompare(right.category)
    return left.label.localeCompare(right.label)
  })
  return rows
}

function rebuildSnapshot() {
  const metricRows = sortedMetricEntries()
  snapshotCache = {
    totals: {
      tracked_metrics: metricRows.length,
      total_events: metricRows.reduce((sum, row) => sum + row.count, 0),
      slow_event_count: slowEvents.length,
    },
    metrics: metricRows,
    slow_events: [...slowEvents],
  }
}

export function getFrontendPerformanceSnapshot(): FrontendPerformanceSnapshot {
  return snapshotCache
}

export function subscribeFrontendPerformance(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function recordFrontendMetric(key: string, durationMs: number, options: RecordOptions = {}) {
  const category = options.category ?? 'interaction'
  const status = options.status ?? 'success'
  const label = metricLabel(key, options.label)
  const safeDuration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0)
  const state = metrics.get(key) ?? {
    label,
    category,
    count: 0,
    success_count: 0,
    error_count: 0,
    total_duration_ms: 0,
    max_duration_ms: 0,
    last_duration_ms: 0,
    last_status: null,
    last_seen_at: null,
  }

  state.label = label
  state.category = category
  state.count += 1
  state.total_duration_ms += safeDuration
  state.max_duration_ms = Math.max(state.max_duration_ms, safeDuration)
  state.last_duration_ms = safeDuration
  state.last_status = status
  state.last_seen_at = nowIso()
  if (status === 'success') {
    state.success_count += 1
  } else {
    state.error_count += 1
  }
  metrics.set(key, state)

  if (safeDuration >= CATEGORY_THRESHOLDS[category]) {
    slowEvents = [
      {
        key,
        label,
        category,
        duration_ms: Number(safeDuration.toFixed(2)),
        status,
        recorded_at: state.last_seen_at,
      },
      ...slowEvents,
    ].slice(0, 8)
  }

  rebuildSnapshot()
  emit()
}

export function resetFrontendPerformanceMetrics() {
  metrics = new Map()
  slowEvents = []
  rebuildSnapshot()
  emit()
}
