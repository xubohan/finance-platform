import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, Radar, RefreshCw, ScanSearch, Search, Sparkles, Waves, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { analyzeEventImpact, getAnalysisTask } from '../api/analysis'
import { extractApiError } from '../api/client'
import {
  backfillEventImpact,
  getEventCalendar,
  getEventDetail,
  getEventHistory,
  getEventImpact,
  getEventTask,
  refreshEvents,
  searchEvents,
  type EventItem,
} from '../api/events'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { BACKGROUND_REFRESH_QUERY_OPTIONS, QUERY_REFRESH_MS } from '../lib/query-refresh'
import { cn } from '../lib/utils'
import { displayFixed, displayPercent, displayText } from '../utils/display'
import { displayPlainText, displayPreviewText, formatDegradedReason } from '../utils/text'
import { formatAsOf, fromDateInputLocal, monthEnd, monthStart, toDateInputLocal } from '../utils/time'

type ImpactResult = {
  event_id: number
  event_title: string
  event_date: string
  impact_by_symbol: Array<{
    symbol: string
    t_plus_1d_ret?: number | null
    t_plus_5d_ret?: number | null
    t_plus_20d_ret?: number | null
    vol_ratio_1d?: number | null
  }>
}

type PredictionDistribution = {
  p10?: number
  p25?: number
  p50?: number
  p75?: number
  p90?: number
}

const EVENT_COLORS: Record<string, string> = {
  macro: 'bg-cyan-400',
  policy: 'bg-amber-400',
  earnings: 'bg-emerald-400',
  geopolitical: 'bg-rose-400',
}

function toneTone(value?: number | null): 'positive' | 'negative' | 'muted' {
  if (typeof value !== 'number') return 'muted'
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'muted'
}

function signedValueClass(value?: number | null) {
  if (typeof value !== 'number' || value === 0) return 'text-slate-500'
  return value > 0 ? 'text-emerald-600' : 'text-rose-600'
}

function buildMonthDays(anchor: Date) {
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const end = new Date(year, month + 1, 0)
  const out: string[] = []
  for (let day = 1; day <= end.getDate(); day += 1) {
    out.push(toDateInputLocal(new Date(year, month, day)))
  }
  return out
}

function scaleDistribution(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || max <= min) return 50
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
}

function modelBadgeLabel(modelUsed?: string, degraded?: boolean) {
  if (degraded) return 'Heuristic fallback'
  if (!modelUsed) return 'Pending'
  return modelUsed
}

function InlineError({ message }: { message: string }) {
  return <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
}

function DistributionBand({
  symbol,
  distribution,
  axisMin,
  axisMax,
}: {
  symbol: string
  distribution?: PredictionDistribution
  axisMin: number
  axisMax: number
}) {
  if (!distribution) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-950">{symbol}</span>
          <span className="text-sm text-slate-400">no distribution</span>
        </div>
      </div>
    )
  }

  const p10 = scaleDistribution(distribution.p10 ?? axisMin, axisMin, axisMax)
  const p25 = scaleDistribution(distribution.p25 ?? distribution.p10 ?? axisMin, axisMin, axisMax)
  const p50 = scaleDistribution(distribution.p50 ?? distribution.p25 ?? distribution.p75 ?? 0, axisMin, axisMax)
  const p75 = scaleDistribution(distribution.p75 ?? distribution.p90 ?? axisMax, axisMin, axisMax)
  const p90 = scaleDistribution(distribution.p90 ?? axisMax, axisMin, axisMax)
  const zero = scaleDistribution(0, axisMin, axisMax)

  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-950">{symbol}</span>
        <span className="text-sm text-slate-500">
          {displayPercent(distribution.p10)} / {displayPercent(distribution.p50)} / {displayPercent(distribution.p90)}
        </span>
      </div>
      <div className="relative mt-4 h-10 rounded-full bg-slate-100">
        <div className="absolute inset-y-2 w-px bg-slate-300" style={{ left: `${zero}%` }} />
        <div
          className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-slate-400"
          style={{ left: `${Math.min(p10, p90)}%`, width: `${Math.max(2, Math.abs(p90 - p10))}%` }}
        />
        <div
          className="absolute top-1/2 h-5 -translate-y-1/2 rounded-full border border-cyan-500/60 bg-cyan-400/25"
          style={{ left: `${Math.min(p25, p75)}%`, width: `${Math.max(2, Math.abs(p75 - p25))}%` }}
        />
        <div className="absolute inset-y-1.5 w-0.5 bg-cyan-700" style={{ left: `${p50}%` }} />
      </div>
    </div>
  )
}

export default function EventsPage() {
  const queryClient = useQueryClient()
  const [selectedDate, setSelectedDate] = useState(toDateInputLocal(new Date()))
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [inspectorTab, setInspectorTab] = useState<'snapshot' | 'analyze'>('snapshot')
  const [searchInput, setSearchInput] = useState('')
  const [refreshTaskId, setRefreshTaskId] = useState<string | null>(null)
  const [lastHandledRefreshTaskId, setLastHandledRefreshTaskId] = useState<string | null>(null)
  const [searchQueryText, setSearchQueryText] = useState('')
  const [searchEventType, setSearchEventType] = useState('')
  const [searchStartDate, setSearchStartDate] = useState('')
  const [searchEndDate, setSearchEndDate] = useState('')
  const [eventText, setEventText] = useState('')
  const [eventType, setEventType] = useState('macro')
  const [symbolsText, setSymbolsText] = useState('SPY,QQQ')
  const [analysis, setAnalysis] = useState<null | {
    sentiment_score?: number
    sentiment_label?: string
    llm_analysis?: { summary?: string; impact_assessment?: string; key_factors?: string[]; risk_factors?: string[] }
    historical_context?: { similar_events_found?: number; sample_description?: string; average_return_5d?: number; win_rate_5d?: number }
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
      return_distribution?: PredictionDistribution
    }>
  }>(null)
  const [analysisMeta, setAnalysisMeta] = useState<{ model_used?: string; degraded?: boolean; degraded_reason?: string | null }>({})
  const [analysisStatus, setAnalysisStatus] = useState<'idle' | 'running' | 'timeout' | 'failed' | 'success'>('idle')
  const [analysisStatusDetail, setAnalysisStatusDetail] = useState('No analysis run yet.')
  const [analysisTaskId, setAnalysisTaskId] = useState<string | null>(null)
  const [lastHandledAnalysisTaskId, setLastHandledAnalysisTaskId] = useState<string | null>(null)

  const selectedDateValue = useMemo(() => fromDateInputLocal(selectedDate), [selectedDate])
  const monthDays = useMemo(() => buildMonthDays(selectedDateValue), [selectedDateValue])
  const calendarRange = useMemo(
    () => ({
      start: monthStart(selectedDateValue),
      end: monthEnd(selectedDateValue),
    }),
    [selectedDateValue],
  )
  const monthLabel = useMemo(
    () =>
      selectedDateValue.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
      }),
    [selectedDateValue],
  )

  const calendarQuery = useQuery({
    queryKey: ['events-calendar', calendarRange.start, calendarRange.end],
    queryFn: () => getEventCalendar(calendarRange),
    refetchInterval: QUERY_REFRESH_MS.events,
  })
  const historyQuery = useQuery({
    queryKey: ['events-history'],
    queryFn: () => getEventHistory({ limit: 12 }),
    refetchInterval: QUERY_REFRESH_MS.events,
  })
  const searchQuery = useQuery({
    queryKey: ['events-search', searchQueryText, searchEventType, searchStartDate, searchEndDate],
    queryFn: () =>
      searchEvents({
        query: searchQueryText,
        event_type: searchEventType || null,
        date_range: [searchStartDate, searchEndDate].filter(Boolean),
      }),
    enabled: searchQueryText.trim().length >= 2,
    refetchInterval: QUERY_REFRESH_MS.events,
  })
  const impactQuery = useQuery({
    queryKey: ['events-impact', selectedEventId],
    queryFn: () => getEventImpact(selectedEventId as number),
    enabled: selectedEventId !== null,
    refetchInterval: QUERY_REFRESH_MS.events,
  })
  const detailQuery = useQuery({
    queryKey: ['events-detail', selectedEventId],
    queryFn: () => getEventDetail(selectedEventId as number),
    enabled: selectedEventId !== null,
    refetchInterval: QUERY_REFRESH_MS.events,
  })
  const analysisMutation = useMutation({
    mutationFn: async () => {
      const symbols = symbolsText
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
      return analyzeEventImpact({
        event_text: eventText,
        event_type: eventType,
        symbols,
        window_days: 20,
      })
    },
    onMutate: () => {
      setAnalysis(null)
      setAnalysisMeta({})
      setAnalysisTaskId(null)
      setLastHandledAnalysisTaskId(null)
      setAnalysisStatus('running')
      setAnalysisStatusDetail('Submitting analysis task...')
    },
    onSuccess: (task) => {
      if (!task.data?.task_id) {
        setAnalysisStatus('failed')
        setAnalysisStatusDetail('The analysis task did not return a task id.')
        return
      }
      setAnalysisTaskId(task.data.task_id)
      setAnalysisStatus('running')
      setAnalysisStatusDetail(`Task ${task.data.task_id} queued. Waiting for result...`)
    },
    onError: (error) => {
      setAnalysisStatus('failed')
      setAnalysisStatusDetail(error instanceof Error ? error.message : 'The analysis request failed.')
      setAnalysis(null)
    },
  })
  const analysisTaskQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['events-analysis-task', analysisTaskId],
    queryFn: () => getAnalysisTask(analysisTaskId ?? ''),
    enabled: Boolean(analysisTaskId),
    refetchInterval: (query) => {
      const status = String((query.state.data as { status?: string } | undefined)?.status ?? '').toLowerCase()
      return status && !['completed', 'failed'].includes(status) ? 1500 : false
    },
  })
  const refreshMutation = useMutation({
    mutationFn: refreshEvents,
    onSuccess: (result) => {
      setRefreshTaskId(result.data?.task_id ?? null)
      setLastHandledRefreshTaskId(null)
    },
  })
  const refreshTaskQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['events-refresh-task', refreshTaskId],
    queryFn: () => getEventTask(refreshTaskId ?? ''),
    enabled: Boolean(refreshTaskId),
    refetchInterval: (query) => {
      const status = String((query.state.data as { data?: { status?: string } } | undefined)?.data?.status ?? '').toLowerCase()
      return status && !['completed', 'failed'].includes(status) ? 2000 : false
    },
  })
  const backfillMutation = useMutation({
    mutationFn: async () => {
      if (selectedEventId === null) throw new Error('No event selected for impact backfill.')
      return backfillEventImpact(selectedEventId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events-impact', selectedEventId] })
    },
  })

  const calendarEvents = calendarQuery.data?.data ?? []
  const historyEvents = historyQuery.data?.data ?? []
  const searchedEvents = searchQuery.data?.data ?? []
  const selectedImpact = (impactQuery.data?.data ?? null) as ImpactResult | null
  const selectedEventDetail = detailQuery.data?.data ?? null
  const calendarMeta = calendarQuery.data?.meta
  const historyMeta = historyQuery.data?.meta
  const searchMeta = searchQuery.data?.meta
  const detailMeta = detailQuery.data?.meta
  const impactMeta = impactQuery.data?.meta
  const refreshPayload = refreshMutation.data?.data
  const refreshTaskStatus = refreshTaskQuery.data?.data?.status ?? refreshPayload?.status ?? null
  const refreshTaskStatusNormalized = String(refreshTaskStatus ?? '').toLowerCase()
  const isRefreshTaskActive = Boolean(refreshTaskId) && Boolean(refreshTaskStatusNormalized) && !['completed', 'failed'].includes(refreshTaskStatusNormalized)
  const calendarError = calendarQuery.error ? extractApiError(calendarQuery.error, 'failed to load event calendar') : null
  const historyError = historyQuery.error ? extractApiError(historyQuery.error, 'failed to load event history') : null
  const searchError = searchQuery.error ? extractApiError(searchQuery.error, 'failed to search events') : null
  const detailError = detailQuery.error ? extractApiError(detailQuery.error, 'failed to load event detail') : null
  const impactError = impactQuery.error ? extractApiError(impactQuery.error, 'failed to load event impact') : null
  const refreshError = refreshMutation.error ? extractApiError(refreshMutation.error, 'failed to refresh events') : null
  const refreshTaskError = refreshTaskQuery.error ? extractApiError(refreshTaskQuery.error, 'failed to load refresh task') : null
  const backfillError = backfillMutation.error ? extractApiError(backfillMutation.error, 'failed to backfill event impact') : null
  const selectedDayEvents = useMemo(() => calendarEvents.filter((item) => item.event_date === selectedDate), [calendarEvents, selectedDate])
  const eventsByDate = useMemo(() => {
    const map = new Map<string, EventItem[]>()
    for (const item of calendarEvents) {
      const current = map.get(item.event_date) ?? []
      current.push(item)
      map.set(item.event_date, current)
    }
    return map
  }, [calendarEvents])

  const analysisBars = useMemo(() => {
    const predictions = analysis?.symbol_predictions ?? []
    return predictions.slice(0, 6).map((item) => ({
      symbol: item.symbol,
      value: (item.confidence ?? 0) * 100,
      direction: item.predicted_direction ?? 'neutral',
    }))
  }, [analysis?.symbol_predictions])
  const analysisPredictions = analysis?.symbol_predictions ?? []
  const analysisTaskError = analysisTaskQuery.error ? extractApiError(analysisTaskQuery.error, 'failed to load analysis task') : null
  const analysisTaskStatusNormalized = String(analysisTaskQuery.data?.status ?? '').toLowerCase()
  const isAnalysisTaskActive = Boolean(analysisTaskId) && Boolean(analysisTaskStatusNormalized) && !['completed', 'failed'].includes(analysisTaskStatusNormalized)
  const distributionAxis = useMemo(() => {
    const values = analysisPredictions.flatMap((item) => {
      const distribution = item.return_distribution
      if (!distribution) return []
      return [distribution.p10, distribution.p25, distribution.p50, distribution.p75, distribution.p90].filter(
        (value): value is number => typeof value === 'number' && Number.isFinite(value),
      )
    })
    if (values.length === 0) {
      return { min: -5, max: 5 }
    }
    return {
      min: Math.min(...values, 0),
      max: Math.max(...values, 0),
    }
  }, [analysisPredictions])

  const shiftMonth = (offset: number) => {
    const next = new Date(selectedDateValue.getFullYear(), selectedDateValue.getMonth() + offset, 1)
    const maxDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    setSelectedDate(toDateInputLocal(new Date(next.getFullYear(), next.getMonth(), Math.min(selectedDateValue.getDate(), maxDay))))
    setSelectedEventId(null)
  }

  const triggerSearch = () => {
    const next = searchInput.trim()
    setSearchQueryText(next)
  }

  const clearSearch = () => {
    setSearchInput('')
    setSearchQueryText('')
    setSearchEventType('')
    setSearchStartDate('')
    setSearchEndDate('')
  }

  const selectedDateLabel = useMemo(
    () =>
      selectedDateValue.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    [selectedDateValue],
  )
  const selectedDayTypeSummary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of selectedDayEvents) {
      counts.set(item.event_type, (counts.get(item.event_type) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
  }, [selectedDayEvents])
  const selectedDaySymbols = useMemo(() => {
    const symbols = new Set<string>()
    for (const item of selectedDayEvents) {
      for (const symbol of item.symbols ?? []) {
        const value = symbol.trim().toUpperCase()
        if (value) symbols.add(value)
      }
    }
    return Array.from(symbols).slice(0, 6)
  }, [selectedDayEvents])
  const historyItems = searchQueryText ? searchedEvents : historyEvents
  const activeHistoryMeta = searchQueryText ? searchMeta : historyMeta

  useEffect(() => {
    const task = analysisTaskQuery.data
    if (!analysisTaskId || !task?.status) return
    if (lastHandledAnalysisTaskId === analysisTaskId && ['completed', 'failed'].includes(task.status)) return
    if (['queued', 'running', 'pending'].includes(task.status)) {
      setAnalysisStatus('running')
      setAnalysisStatusDetail(`Task ${analysisTaskId} ${task.status}. Waiting for result...`)
      return
    }
    if (task.status === 'failed') {
      setAnalysisStatus('failed')
      setAnalysisStatusDetail(task.error ? `Task ${analysisTaskId} failed: ${task.error}` : `Task ${analysisTaskId} failed before producing a result.`)
      setLastHandledAnalysisTaskId(analysisTaskId)
      return
    }
    if (task.status === 'completed') {
      if (task.result?.data) {
        setAnalysis(task.result.data)
        setAnalysisMeta({
          model_used: task.result.meta?.model_used,
          degraded: task.result.meta?.degraded,
          degraded_reason: task.result.meta?.degraded_reason,
        })
        setAnalysisStatus('success')
        setAnalysisStatusDetail(`Task ${analysisTaskId} completed.`)
      } else {
        setAnalysisStatus('failed')
        setAnalysisStatusDetail(`Task ${analysisTaskId} completed without a result payload.`)
      }
      setLastHandledAnalysisTaskId(analysisTaskId)
    }
  }, [analysisTaskId, analysisTaskQuery.data, lastHandledAnalysisTaskId])

  useEffect(() => {
    const taskData = refreshTaskQuery.data?.data
    if (!taskData?.task_id || !taskData.status) return
    if (lastHandledRefreshTaskId === taskData.task_id && ['completed', 'failed'].includes(String(taskData.status))) return
    if (taskData.status === 'completed') {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['events-calendar'] }),
        queryClient.invalidateQueries({ queryKey: ['events-history'] }),
        queryClient.invalidateQueries({ queryKey: ['events-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['events-impact'] }),
      ])
      setLastHandledRefreshTaskId(taskData.task_id)
      return
    }
    if (taskData.status === 'failed') {
      setLastHandledRefreshTaskId(taskData.task_id)
    }
  }, [lastHandledRefreshTaskId, queryClient, refreshTaskQuery.data])

  return (
    <div data-page="events-center" className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] 2xl:grid-cols-[minmax(0,1.14fr)_minmax(392px,0.86fr)]">
      <div data-layout-role="primary" className="grid min-w-0 gap-6">
        <Card className="min-w-0 p-6">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-cyan-600" />
                  Event Browser
                </CardTitle>
                <CardDescription>Use the calendar to choose a day, then work through the queue for that date without mixing analysis controls into the same surface.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending || isRefreshTaskActive}>
                  <RefreshCw className={cn('h-4 w-4', refreshMutation.isPending || isRefreshTaskActive ? 'animate-spin' : undefined)} />
                  Refresh
                </Button>
                <Button variant="chip" size="sm" onClick={() => shiftMonth(-1)} aria-label="上一月">
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <Badge tone="muted">{monthLabel}</Badge>
                <Button variant="chip" size="sm" onClick={() => shiftMonth(1)} aria-label="下一月">
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,0.88fr)_minmax(280px,1.12fr)]">
            <div className="space-y-5">
              {calendarError ? <InlineError message={calendarError} /> : null}
              {refreshError ? <InlineError message={refreshError} /> : null}
              {refreshTaskError ? <InlineError message={refreshTaskError} /> : null}
              <div className="flex flex-wrap gap-2">
                <Badge tone={calendarMeta?.stale ? 'warning' : 'muted'}>{displayText(calendarMeta?.source, 'persisted')}</Badge>
                <Badge tone="muted">refresh {displayText(refreshTaskStatus, 'idle')}</Badge>
                <Badge tone="muted">{formatAsOf(calendarMeta?.as_of ?? calendarMeta?.generated_at)}</Badge>
              </div>
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {monthDays.map((day) => {
                  const items = eventsByDate.get(day) ?? []
                  const isActive = selectedDate === day
                  const primaryType = items[0]?.event_type ?? 'macro'
                  return (
                    <button
                      key={day}
                      type="button"
                      className={cn(
                        'relative min-w-0 overflow-hidden rounded-2xl border px-2 py-2.5 text-left transition sm:px-2.5 sm:py-3 md:px-3',
                        isActive ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50/90 text-slate-700 hover:border-cyan-200 hover:bg-cyan-50/30',
                      )}
                      onClick={() => setSelectedDate(day)}
                    >
                      <strong className="block pr-3 text-xs leading-none sm:text-sm">{day.slice(-2)}</strong>
                      {items.length > 0 ? (
                        <span className={cn('absolute right-2 top-2 h-2 w-2 rounded-full', EVENT_COLORS[primaryType] ?? 'bg-slate-300')} />
                      ) : null}
                      <div className="mt-1 h-4 sm:mt-2">
                        {items.length > 0 ? (
                          <p className={cn('text-[9px] leading-3 sm:text-[10px] sm:leading-4', isActive ? 'text-slate-300' : 'text-slate-400')}>
                            {items.length} evt
                          </p>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white/70 p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Selected Day</p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">{selectedDateLabel}</p>
                  </div>
                  <Badge tone={selectedDayEvents.length > 0 ? 'default' : 'muted'}>{selectedDayEvents.length} events</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={calendarMeta?.stale ? 'warning' : 'positive'}>{displayText(calendarMeta?.source, 'persisted')}</Badge>
                  <Badge tone="muted">as_of {formatAsOf(calendarMeta?.as_of)}</Badge>
                  <Badge tone="muted">read_only {String(Boolean(calendarMeta?.read_only))}</Badge>
                </div>
                {selectedDayEvents.length > 0 ? (
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {selectedDayTypeSummary.map(([type, count]) => (
                        <Badge key={`day-type-${type}`} tone="muted">
                          {type} x{count}
                        </Badge>
                      ))}
                    </div>
                    {selectedDaySymbols.length > 0 ? (
                      <p className="text-sm leading-7 text-slate-500">
                        Symbols in scope: <span className="font-medium text-slate-700">{selectedDaySymbols.join(', ')}</span>
                      </p>
                    ) : null}
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Lead item</p>
                      <p className="mt-2 text-safe-wrap text-sm font-semibold text-slate-950">
                        {displayPreviewText(selectedDayEvents[0]?.title, 112)}
                      </p>
                      <p className="mt-3 text-sm leading-7 text-slate-500">Open the queue to inspect one event at a time, then switch to the inspector to read impact or run analysis.</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-7 text-slate-500">
                    {calendarError
                      ? 'Calendar data is unavailable right now. Retry after the request issue is resolved.'
                      : 'This day has no scheduled events. Pick another date or use Recent History to open archived items.'}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50/65 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Selected Day Queue</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">Work through the day, one event at a time.</p>
                </div>
                <Badge tone={selectedDayEvents.length > 0 ? 'default' : 'muted'}>{selectedDayEvents.length} items</Badge>
              </div>
              {selectedDayEvents.length > 0 ? (
                <div className="mt-4 max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                  {selectedDayEvents.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        'w-full rounded-3xl border p-4 text-left transition',
                        selectedEventId === item.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white/85 text-slate-900 hover:border-cyan-200 hover:bg-cyan-50/30',
                      )}
                      onClick={() => {
                        setSelectedEventId(item.id)
                        setInspectorTab('snapshot')
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="default" className={cn(selectedEventId === item.id ? 'border-white/10 bg-white/10 text-white' : '')}>
                          {item.event_type}
                        </Badge>
                        <span className={cn('text-xs uppercase tracking-widest', selectedEventId === item.id ? 'text-slate-300' : 'text-slate-400')}>
                          {item.event_date}
                        </span>
                      </div>
                      <p className="mt-3 text-base font-semibold">{item.title}</p>
                      <p className={cn('mt-2 text-safe-wrap text-sm', selectedEventId === item.id ? 'text-slate-300' : 'text-slate-500')}>
                        {displayPreviewText((item.symbols ?? []).join(', '), 88, 'broad market')}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  {calendarError ? 'The event queue is empty because the calendar request failed.' : 'No events on the selected date.'}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-layout-role="tertiary" className="min-w-0 p-6">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Radar className="h-5 w-5 text-cyan-600" />
                  Recent History
                </CardTitle>
                <CardDescription>Use history only when you need to reopen archived events or search across older items. It should not compete with the browser above.</CardDescription>
              </div>
              <Badge tone="muted">{historyItems.length} items</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {searchQueryText ? (searchError ? <InlineError message={searchError} /> : null) : historyError ? <InlineError message={historyError} /> : null}
            <div className="flex flex-wrap gap-2">
              <Badge tone={activeHistoryMeta?.stale ? 'warning' : 'positive'}>{displayText(activeHistoryMeta?.source, 'persisted')}</Badge>
              <Badge tone="muted">as_of {formatAsOf(activeHistoryMeta?.as_of)}</Badge>
              <Badge tone="muted">read_only {String(Boolean(activeHistoryMeta?.read_only))}</Badge>
            </div>
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50/90 px-3 py-2 sm:flex-nowrap">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  className="min-w-[12rem] flex-1 border-0 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="search title / description"
                />
                <Button variant="chip" size="sm" className="shrink-0" onClick={triggerSearch} disabled={searchInput.trim().length < 2}>
                  Search
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <select
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-950 outline-none"
                  value={searchEventType}
                  onChange={(event) => setSearchEventType(event.target.value)}
                >
                  <option value="">all types</option>
                  <option value="macro">macro</option>
                  <option value="policy">policy</option>
                  <option value="earnings">earnings</option>
                  <option value="geopolitical">geopolitical</option>
                </select>
                <Button variant="secondary" size="sm" onClick={clearSearch} disabled={!searchQueryText && !searchEventType && !searchStartDate && !searchEndDate && !searchInput}>
                  <XCircle className="h-4 w-4" />
                  Clear
                </Button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-950 outline-none"
                  type="date"
                  value={searchStartDate}
                  onChange={(event) => setSearchStartDate(event.target.value)}
                />
                <input
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-950 outline-none"
                  type="date"
                  value={searchEndDate}
                  onChange={(event) => setSearchEndDate(event.target.value)}
                />
              </div>
            </div>

            {historyItems.length > 0 ? (
              <div className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
                {historyItems.map((item) => (
                  <button
                    key={`history-${item.id}`}
                    type="button"
                    className={cn(
                      'w-full rounded-3xl border p-4 text-left transition',
                      selectedEventId === item.id ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-slate-50/90 text-slate-900 hover:border-cyan-200 hover:bg-cyan-50/30',
                    )}
                    onClick={() => {
                      setSelectedEventId(item.id)
                      setInspectorTab('snapshot')
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', EVENT_COLORS[item.event_type] ?? 'bg-slate-300')} />
                      <span className={cn('text-xs uppercase tracking-widest', selectedEventId === item.id ? 'text-slate-300' : 'text-slate-400')}>
                        {item.event_type} · {item.event_date}
                      </span>
                    </div>
                    <p className="mt-3 text-base font-semibold">{item.title}</p>
                    <p className={cn('mt-2 text-safe-wrap text-sm', selectedEventId === item.id ? 'text-slate-300' : 'text-slate-500')}>
                      {displayPreviewText((item.symbols ?? []).join(', '), 88, 'broad market')}
                    </p>
                  </button>
                ))}
              </div>
            ) : searchQueryText ? (
              searchError ? null : <p className="text-sm text-slate-500">No search results.</p>
            ) : historyError ? null : (
              <p className="text-sm text-slate-500">No recent history events.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div data-layout-role="secondary" className="grid min-w-0 gap-6 self-start xl:sticky xl:top-4">
        <Card className="min-w-0 p-6">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {inspectorTab === 'snapshot' ? <Waves className="h-5 w-5 text-cyan-600" /> : <ScanSearch className="h-5 w-5 text-cyan-600" />}
                  Event Inspector
                </CardTitle>
                <CardDescription>Keep snapshot reading and analysis in one inspector, but never at the same time. Choose the tab that matches your next action.</CardDescription>
              </div>
              {inspectorTab === 'analyze' ? <Badge tone={analysisMeta.degraded ? 'warning' : 'default'}>{modelBadgeLabel(analysisMeta.model_used, analysisMeta.degraded)}</Badge> : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Button variant={inspectorTab === 'snapshot' ? 'primary' : 'chip'} size="sm" onClick={() => setInspectorTab('snapshot')}>
                Snapshot
              </Button>
              <Button variant={inspectorTab === 'analyze' ? 'primary' : 'chip'} size="sm" onClick={() => setInspectorTab('analyze')}>
                Analyze
              </Button>
            </div>

            {inspectorTab === 'snapshot' ? (
              <>
                {detailError ? <InlineError message={detailError} /> : null}
                {selectedEventDetail ? (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{selectedEventDetail.event_type}</Badge>
                      <span className="text-xs uppercase tracking-widest text-slate-400">{selectedEventDetail.event_date}</span>
                      <span className="text-xs text-slate-400">{displayText(selectedEventDetail.source, 'source n/a')}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge tone="muted">{displayText(detailMeta?.source, 'persisted')}</Badge>
                      <Badge tone="muted">as_of {formatAsOf(detailMeta?.as_of)}</Badge>
                      <Badge tone="muted">read_only {String(Boolean(detailMeta?.read_only))}</Badge>
                    </div>
                    <p className="mt-3 text-safe-wrap text-lg font-semibold text-slate-950">{selectedEventDetail.title}</p>
                    <div className="mt-3 max-h-48 overflow-y-auto pr-1 text-safe-wrap text-sm leading-7 text-slate-500">
                      {displayPlainText(selectedEventDetail.description, 'No detail description.')}
                    </div>
                    {selectedEventDetail.source_url ? (
                      <a
                        href={selectedEventDetail.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block break-all text-xs text-cyan-700 underline decoration-dotted underline-offset-4"
                      >
                        open source link
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-white/65 p-5 text-sm leading-7 text-slate-500">
                    {detailError
                      ? 'Event detail could not be loaded. Pick another item or retry after the request issue is resolved.'
                      : 'Select a calendar event or history item to inspect its detail and impact profile.'}
                  </div>
                )}

                {impactError ? <InlineError message={impactError} /> : null}
                {backfillError ? <InlineError message={backfillError} /> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={impactMeta?.stale ? 'warning' : 'positive'}>{displayText(impactMeta?.source, 'persisted')}</Badge>
                  <Badge tone="muted">as_of {formatAsOf(impactMeta?.as_of)}</Badge>
                  <Badge tone="muted">read_only {String(Boolean(impactMeta?.read_only))}</Badge>
                  <Button
                    variant="chip"
                    size="sm"
                    onClick={() => backfillMutation.mutate()}
                    disabled={selectedEventId === null || backfillMutation.isPending}
                  >
                    {backfillMutation.isPending ? 'Backfilling' : 'Backfill impact'}
                  </Button>
                </div>
                {backfillMutation.data?.data ? (
                  <p className="text-sm text-cyan-700">
                    backfill {displayText(backfillMutation.data.data.status, 'accepted')} · inserted {displayText(backfillMutation.data.data.inserted_records, '0')}
                  </p>
                ) : null}
                {selectedImpact ? (
                  <div className="grid gap-3">
                    {selectedImpact.impact_by_symbol.map((item) => (
                      <div key={item.symbol} className="rounded-3xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-slate-950">{item.symbol}</p>
                          <Badge tone="muted">vol {displayFixed(item.vol_ratio_1d)}</Badge>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">T+1D</p>
                            <p className={cn('mt-1 font-semibold', signedValueClass(item.t_plus_1d_ret))}>{displayPercent(item.t_plus_1d_ret)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">T+5D</p>
                            <p className={cn('mt-1 font-semibold', signedValueClass(item.t_plus_5d_ret))}>{displayPercent(item.t_plus_5d_ret)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">T+20D</p>
                            <p className={cn('mt-1 font-semibold', signedValueClass(item.t_plus_20d_ret))}>{displayPercent(item.t_plus_20d_ret)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    {impactError ? 'Impact stats are unavailable because the request failed.' : 'Impact stats will appear here after you select a specific event.'}
                  </p>
                )}

                <Button variant="secondary" className="h-11 w-full rounded-2xl" onClick={() => setInspectorTab('analyze')}>
                  Open analyzer for this event
                </Button>
              </>
            ) : (
              <>
                {selectedEventDetail ? (
                  <div className="rounded-3xl border border-cyan-200 bg-cyan-50/70 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{selectedEventDetail.event_type}</Badge>
                      <span className="text-xs uppercase tracking-widest text-cyan-700/80">{selectedEventDetail.event_date}</span>
                      <span className="text-xs text-cyan-700/80">{displayText(selectedEventDetail.source, 'source n/a')}</span>
                    </div>
                    <p className="mt-2 text-safe-wrap text-sm font-semibold text-slate-950">{displayPreviewText(selectedEventDetail.title, 120)}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="chip"
                        size="sm"
                        onClick={() => {
                          setEventText(displayPlainText(selectedEventDetail.description, selectedEventDetail.title))
                          setEventType(selectedEventDetail.event_type || eventType)
                          setSymbolsText((selectedEventDetail.symbols ?? []).join(','))
                        }}
                      >
                        Use detail as input
                      </Button>
                      <Button
                        variant="chip"
                        size="sm"
                        onClick={() => {
                          setEventText(selectedEventDetail.title)
                          setEventType(selectedEventDetail.event_type || eventType)
                          setSymbolsText((selectedEventDetail.symbols ?? []).join(','))
                        }}
                      >
                        Use title only
                      </Button>
                    </div>
                  </div>
                ) : null}

                <textarea
                  className="min-h-44 w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-safe-wrap text-[13px] leading-6 text-slate-950 outline-none transition focus:border-cyan-300 focus:bg-white"
                  value={eventText}
                  onChange={(event) => setEventText(event.target.value)}
                  placeholder="paste event or news text"
                />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <select className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={eventType} onChange={(event) => setEventType(event.target.value)}>
                    <option value="macro">macro</option>
                    <option value="policy">policy</option>
                    <option value="earnings">earnings</option>
                    <option value="geopolitical">geopolitical</option>
                  </select>
                  <input className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={symbolsText} onChange={(event) => setSymbolsText(event.target.value)} placeholder="SPY,QQQ,TLT" />
                </div>
                <Button
                  className="h-12 w-full rounded-2xl"
                  onClick={() => {
                    setInspectorTab('analyze')
                    setAnalysis(null)
                    setAnalysisMeta({})
                    analysisMutation.mutate()
                  }}
                  disabled={analysisMutation.isPending || isAnalysisTaskActive || !eventText.trim()}
                >
                  {analysisMutation.isPending || isAnalysisTaskActive ? 'Analyzing' : 'Analyze'}
                </Button>
                <p className="text-xs leading-6 text-slate-500">Tip: you can paste a raw headline, earnings note, or macro bulletin. The output pane below will stay structurally separate from this composer.</p>
              </>
            )}
          </CardContent>
        </Card>

        {inspectorTab === 'analyze' && analysis ? (
          <>
            <Card className="p-6">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-cyan-600" />
                      Analysis Readout
                    </CardTitle>
                    <CardDescription>Summary, impact assessment, and historical context live in a separate high-contrast result panel instead of mixing with the composer.</CardDescription>
                  </div>
                  <Badge tone={toneTone(analysis.sentiment_score)}>sentiment {displayFixed(analysis.sentiment_score, 3)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="panel-dark-solid rounded-3xl border border-slate-200 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warning" className="border-white/10 bg-white/10 text-cyan-200">
                      {analysis.sentiment_label}
                    </Badge>
                    {analysisMeta.degraded ? (
                      <Badge tone="warning" className="border-white/10 bg-white/10 text-amber-100">
                        heuristic fallback
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-widest text-slate-400">Summary</p>
                      <p className="mt-2 text-safe-wrap text-sm leading-7 text-slate-100">
                        {displayPlainText(analysis.llm_analysis?.summary, 'No summary available.')}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-widest text-slate-400">Impact assessment</p>
                      <p className="mt-2 text-safe-wrap text-sm leading-7 text-slate-200">
                        {displayPlainText(analysis.llm_analysis?.impact_assessment, 'No impact assessment available.')}
                      </p>
                    </div>
                    {(analysis.llm_analysis?.key_factors?.length ?? 0) > 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-widest text-slate-400">Key factors</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(analysis.llm_analysis?.key_factors ?? []).map((item) => (
                            <Badge key={`key-${item}`} tone="muted" className="border-white/10 bg-white/10 text-slate-100">
                              {displayPreviewText(item, 48)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {(analysis.llm_analysis?.risk_factors?.length ?? 0) > 0 ? (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-widest text-slate-400">Risk factors</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(analysis.llm_analysis?.risk_factors ?? []).map((item) => (
                            <Badge key={`risk-${item}`} tone="warning" className="border-white/10 bg-white/10 text-amber-100">
                              {displayPreviewText(item, 48)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-4 text-xs uppercase tracking-widest text-slate-400">
                    {analysisMeta.degraded ? formatDegradedReason(analysisMeta.degraded_reason) : 'LLM-assisted result'}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Similar events</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{displayText(analysis.historical_context?.similar_events_found, '0')}</p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Avg 5D</p>
                    <p className={cn('mt-2 text-xl font-semibold', signedValueClass(analysis.historical_context?.average_return_5d))}>
                      {displayPercent(analysis.historical_context?.average_return_5d)}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Win rate</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{displayPercent(analysis.historical_context?.win_rate_5d)}</p>
                  </div>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                  <p className="text-xs uppercase tracking-widest text-slate-400">Historical context</p>
                  <p className="mt-3 text-safe-wrap text-sm leading-7 text-slate-500">
                    {displayPlainText(analysis.historical_context?.sample_description, 'No historical sample description available.')}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="p-6">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Radar className="h-5 w-5 text-cyan-600" />
                      Prediction Matrix
                    </CardTitle>
                    <CardDescription>Replace narrow tables with one forecast card per symbol so confidence, sample size, and return metrics stay readable.</CardDescription>
                  </div>
                  <Badge tone="muted">{analysisPredictions.length} symbols</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {analysisPredictions.length > 0 ? (
                  <div className="grid gap-3">
                    {analysisPredictions.map((item) => (
                      <div key={`prediction-${item.symbol}`} className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-lg font-semibold text-slate-950">{item.symbol}</p>
                            <p className="mt-1 text-sm text-slate-500">{displayPreviewText(item.basis, 120, 'Historical basis unavailable.')}</p>
                          </div>
                          <Badge tone={item.predicted_direction === 'up' ? 'positive' : item.predicted_direction === 'down' ? 'negative' : 'muted'}>
                            {displayText(item.predicted_direction, 'neutral')}
                          </Badge>
                        </div>
                        <div className="mt-4">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-500">confidence</span>
                            <span className="font-medium text-slate-950">{displayPercent((item.confidence ?? 0) * 100)}</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                item.predicted_direction === 'up' ? 'bg-emerald-400' : item.predicted_direction === 'down' ? 'bg-rose-400' : 'bg-slate-400',
                              )}
                              style={{ width: `${Math.min(100, Math.max(10, (item.confidence ?? 0) * 100))}%` }}
                            />
                          </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Samples</p>
                            <p className="mt-1 font-semibold text-slate-950">{displayText(item.sample_size, '0')}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Win rate</p>
                            <p className="mt-1 font-semibold text-slate-950">{displayPercent((item.historical_win_rate_5d ?? 0) * 100)}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Avg 5D</p>
                            <p className={cn('mt-1 font-semibold', signedValueClass(item.historical_avg_return_5d))}>{displayPercent(item.historical_avg_return_5d)}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-3">
                            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Avg 20D</p>
                            <p className={cn('mt-1 font-semibold', signedValueClass(item.historical_avg_return_20d))}>{displayPercent(item.historical_avg_return_20d)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No symbol predictions were returned for this analysis run.</p>
                )}

                {analysisPredictions.length > 0 ? (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold text-slate-950">Return distribution bands</p>
                      <span className="text-xs uppercase tracking-widest text-slate-400">
                        axis {displayPercent(distributionAxis.min)} to {displayPercent(distributionAxis.max)}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3">
                      {analysisPredictions.map((item) => (
                        <DistributionBand
                          key={`dist-${item.symbol}`}
                          symbol={item.symbol}
                          distribution={item.return_distribution}
                          axisMin={distributionAxis.min}
                          axisMax={distributionAxis.max}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </>
        ) : inspectorTab === 'analyze' ? (
          <Card className="p-6">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-cyan-600" />
                  Analysis Output
                </CardTitle>
                <CardDescription>Keep the result area independent. Before a run completes, show only an empty-state explanation instead of stretching the input card.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white/65 p-5 text-sm leading-7 text-slate-500">
                Analysis output will appear here, including sentiment, key factors, historical context, and the symbol prediction matrix.
              </div>
              <div
                className={cn(
                  'rounded-3xl border p-4 text-sm leading-7',
                  analysisStatus === 'timeout'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : analysisStatus === 'failed'
                      ? 'border-rose-200 bg-rose-50 text-rose-900'
                      : analysisStatus === 'running'
                        ? 'border-cyan-200 bg-cyan-50 text-cyan-900'
                        : 'border-slate-200 bg-slate-50/90 text-slate-600',
                )}
              >
                {analysisTaskError ? <InlineError message={analysisTaskError} /> : null}
                <p className="font-medium">
                  {analysisStatus === 'running'
                    ? 'Analysis is running.'
                    : analysisStatus === 'timeout'
                      ? 'Analysis timed out.'
                      : analysisStatus === 'failed'
                        ? 'Analysis failed.'
                        : analysisStatus === 'success'
                          ? 'Analysis completed.'
                        : 'Analysis is idle.'}
                </p>
                <p className="mt-2">{analysisStatusDetail}</p>
                {analysisTaskId ? <p className="mt-2 text-xs uppercase tracking-widest text-slate-500">task_id {analysisTaskId}</p> : null}
                {(analysisStatus === 'timeout' || analysisStatus === 'failed') && eventText.trim() ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setAnalysis(null)
                      setAnalysisMeta({})
                      setAnalysisStatus('running')
                      setAnalysisStatusDetail('Polling analysis task...')
                      analysisMutation.mutate()
                    }}
                  >
                    Retry analysis
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
