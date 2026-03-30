import { useMutation, useQuery } from '@tanstack/react-query'
import { BarChart3, FlaskConical, History, Play, RotateCcw, ScanLine, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  compareBacktestStrategies,
  extractBacktestTaskId,
  getBacktestTask,
  getBacktestStrategies,
  runBacktest,
  type BacktestAsyncState,
  type BacktestCompareRankingMetric,
  type BacktestCompareRow,
  type BacktestCompareResponse,
  type BacktestRunMeta,
  type BacktestRunData,
  type BacktestRunResponse,
  type BacktestTaskKind,
  type BacktestTrade,
} from '../api/backtest'
import { extractApiError } from '../api/client'
import EquityCurve from '../components/backtest/EquityCurve'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { BACKGROUND_REFRESH_QUERY_OPTIONS } from '../lib/query-refresh'
import { cn } from '../lib/utils'
import { COMPARE_STRATEGY_TEMPLATES } from '../utils/compareStrategyTemplates'
import {
  clearCompareSnapshotHistoryStorage,
  persistCompareSnapshotHistory,
  readCompareSnapshotHistory,
  type CompareSnapshotHistoryItem,
} from '../utils/compareSnapshotHistory'
import { buildStrategyParameters, fallbackStrategyMode } from '../utils/backtestParameters'
import {
  DEFAULT_COMPARE_STRATEGIES,
  getFastLabel,
  getOscillatorPeriodLabel,
  getSlowLabel,
  getThresholdLabels,
  isFastSlowStrategy,
  isOscillatorStrategy,
  isPeriodMultiplierStrategy,
  isThresholdStrategy,
  type BacktestStrategyName,
} from '../utils/backtestStrategies'
import { displayFixed, displayPercent, displayText } from '../utils/display'
import { toDateInputLocal, yearsAgo } from '../utils/time'

type ResultTab = 'trades' | 'monthly'

function InlineError({ message }: { message: string }) {
  return <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
}

function isRunDataPayload(value: unknown): value is BacktestRunData {
  if (!value || typeof value !== 'object') return false
  return Array.isArray((value as { equity_curve?: unknown }).equity_curve)
}

function isAsyncTaskPayload(value: unknown): value is BacktestAsyncState {
  if (!value || typeof value !== 'object') return false
  return 'task_id' in (value as Record<string, unknown>) || 'status' in (value as Record<string, unknown>)
}

function isBacktestRunResponsePayload(value: unknown): value is BacktestRunResponse {
  if (!value || typeof value !== 'object') return false
  const payload = value as { data?: unknown }
  return isRunDataPayload(payload.data)
}

function isBacktestCompareResponsePayload(value: unknown): value is BacktestCompareResponse {
  if (!value || typeof value !== 'object') return false
  const payload = value as { data?: unknown; curves?: unknown }
  return Array.isArray(payload.data) && Array.isArray(payload.curves)
}

function taskTone(status?: string | null): 'positive' | 'warning' | 'negative' | 'muted' {
  if (status === 'completed') return 'positive'
  if (status === 'failed') return 'negative'
  if (status === 'queued' || status === 'running') return 'warning'
  return 'muted'
}

type PendingCompareSnapshot = {
  symbol: string
  assetType: 'stock' | 'crypto'
  strategyName: BacktestStrategyName
  compareStrategyNames: BacktestStrategyName[]
  compareRankingMetric: BacktestCompareRankingMetric
  fast: number
  slow: number
  rsiPeriod: number
  oversold: number
  overbought: number
  multiplier: number
  initialCapital: number
  backtestStartDate: string
  backtestEndDate: string
  syncIfMissing: boolean
}

function buildDrawdownCurve(curve: Array<{ date: string; value: number }>) {
  let peak = Number.NEGATIVE_INFINITY
  return curve.map((point) => {
    peak = Math.max(peak, point.value)
    const drawdown = peak <= 0 ? 0 : ((point.value - peak) / peak) * 100
    return { date: point.date, value: drawdown }
  })
}

function buildMonthlyHeatmap(curve: Array<{ date: string; value: number }>) {
  const monthly = new Map<string, { start: number; end: number }>()
  for (const point of curve) {
    const month = point.date.slice(0, 7)
    const current = monthly.get(month)
    if (!current) {
      monthly.set(month, { start: point.value, end: point.value })
    } else {
      current.end = point.value
    }
  }
  return Array.from(monthly.entries()).map(([month, values]) => ({
    month,
    returnPct: values.start === 0 ? 0 : ((values.end - values.start) / values.start) * 100,
  }))
}

function buildCompareSnapshot(args: {
  symbol: string
  assetType: 'stock' | 'crypto'
  strategyName: BacktestStrategyName
  compareStrategyNames: BacktestStrategyName[]
  compareRankingMetric: BacktestCompareRankingMetric
  fast: number
  slow: number
  rsiPeriod: number
  oversold: number
  overbought: number
  multiplier: number
  initialCapital: number
  backtestStartDate: string
  backtestEndDate: string
  syncIfMissing: boolean
  comparison: BacktestCompareRow[]
  asOf?: string | null
  storageSource?: string | null
}): CompareSnapshotHistoryItem | null {
  const best = args.comparison[0]
  if (!best) return null
  const currentRank = args.comparison.findIndex((row) => row.strategy_name === args.strategyName)
  return {
    symbol: args.symbol,
    assetType: args.assetType,
    strategyName: args.strategyName,
    compareStrategyNames: args.compareStrategyNames,
    compareRankingMetric: args.compareRankingMetric,
    fast: args.fast,
    slow: args.slow,
    rsiPeriod: args.rsiPeriod,
    oversold: args.oversold,
    overbought: args.overbought,
    multiplier: args.multiplier,
    initialCapital: args.initialCapital,
    backtestStartDate: args.backtestStartDate,
    backtestEndDate: args.backtestEndDate,
    syncIfMissing: args.syncIfMissing,
    bestStrategyName: best.strategy_name,
    bestStrategyLabel: best.label,
    currentRank: currentRank >= 0 ? currentRank + 1 : null,
    storageSource: args.storageSource ?? null,
    asOf: args.asOf ?? null,
    createdAt: new Date().toISOString(),
  }
}

export default function BacktestWorkbenchPage() {
  const [searchParams] = useSearchParams()
  const initialSymbol = (searchParams.get('symbol') ?? 'AAPL').toUpperCase()
  const initialAssetType = searchParams.get('asset_type') === 'crypto' ? 'crypto' : 'stock'

  const [symbol, setSymbol] = useState(initialSymbol)
  const [assetType, setAssetType] = useState<'stock' | 'crypto'>(initialAssetType)
  const [strategyName, setStrategyName] = useState<BacktestStrategyName>('ema_cross')
  const [startDate, setStartDate] = useState(yearsAgo(1))
  const [endDate, setEndDate] = useState(toDateInputLocal(new Date()))
  const [fast, setFast] = useState('10')
  const [slow, setSlow] = useState('30')
  const [period, setPeriod] = useState('14')
  const [threshold, setThreshold] = useState('20')
  const [overbought, setOverbought] = useState('70')
  const [multiplier, setMultiplier] = useState('2')
  const [initialCapital, setInitialCapital] = useState('1000000')
  const [syncIfMissing, setSyncIfMissing] = useState(true)
  const [comparisonPool, setComparisonPool] = useState<BacktestStrategyName[]>(DEFAULT_COMPARE_STRATEGIES)
  const [rankingMetric, setRankingMetric] = useState<BacktestCompareRankingMetric>('sharpe_ratio')
  const [resultTab, setResultTab] = useState<ResultTab>('trades')
  const [historyItems, setHistoryItems] = useState<CompareSnapshotHistoryItem[]>(() => readCompareSnapshotHistory())
  const [previousStrategy, setPreviousStrategy] = useState<BacktestStrategyName | null>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [activeTaskKind, setActiveTaskKind] = useState<BacktestTaskKind | null>(null)
  const [resolvedRunResponse, setResolvedRunResponse] = useState<BacktestRunResponse | null>(null)
  const [resolvedCompareResponse, setResolvedCompareResponse] = useState<BacktestCompareResponse | null>(null)
  const [pendingCompareSnapshot, setPendingCompareSnapshot] = useState<PendingCompareSnapshot | null>(null)
  const [lastHandledTaskId, setLastHandledTaskId] = useState<string | null>(null)

  const strategiesQuery = useQuery({
    queryKey: ['backtest-strategies'],
    queryFn: getBacktestStrategies,
  })

  const runMutation = useMutation({
    mutationFn: () =>
      runBacktest({
        symbol: symbol.trim().toUpperCase(),
        asset_type: assetType,
        strategy_name: strategyName,
        parameters: parameterPayload,
        start_date: startDate,
        end_date: endDate,
        initial_capital: Number(initialCapital),
        sync_if_missing: syncIfMissing,
      }, { asyncMode: true }),
    onMutate: () => {
      setActiveTaskKind('run')
      setLastHandledTaskId(null)
      setResolvedRunResponse(null)
      setResolvedCompareResponse(null)
      setPendingCompareSnapshot(null)
    },
    onSuccess: (resp) => {
      const taskId = extractBacktestTaskId(resp)
      if (taskId) {
        setActiveTaskId(taskId)
        return
      }
      setActiveTaskId(null)
      if (isRunDataPayload(resp.data)) {
        setResolvedRunResponse(resp)
      }
    },
  })

  const compareMutation = useMutation({
    mutationFn: () =>
      compareBacktestStrategies({
        symbol: symbol.trim().toUpperCase(),
        asset_type: assetType,
        strategy_names: compareStrategyNames,
        parameters_by_strategy: compareParametersByStrategy,
        start_date: startDate,
        end_date: endDate,
        initial_capital: Number(initialCapital),
        sync_if_missing: syncIfMissing,
        ranking_metric: rankingMetric,
      }, { asyncMode: true }),
    onMutate: () => {
      setActiveTaskKind('compare')
      setLastHandledTaskId(null)
      setResolvedRunResponse(null)
      setResolvedCompareResponse(null)
      setPendingCompareSnapshot({
        symbol: symbol.trim().toUpperCase(),
        assetType,
        strategyName,
        compareStrategyNames,
        compareRankingMetric: rankingMetric,
        fast: Number(fast),
        slow: Number(slow),
        rsiPeriod: Number(period),
        oversold: Number(threshold),
        overbought: Number(overbought),
        multiplier: Number(multiplier),
        initialCapital: Number(initialCapital),
        backtestStartDate: startDate,
        backtestEndDate: endDate,
        syncIfMissing,
      })
    },
    onSuccess: (resp) => {
      const taskId = extractBacktestTaskId(resp)
      if (taskId) {
        setActiveTaskId(taskId)
        return
      }
      setActiveTaskId(null)
      if (Array.isArray(resp.data)) {
        setResolvedCompareResponse(resp)
        const snapshot = buildCompareSnapshot({
          symbol: symbol.trim().toUpperCase(),
          assetType,
          strategyName,
          compareStrategyNames,
          compareRankingMetric: rankingMetric,
          fast: Number(fast),
          slow: Number(slow),
          rsiPeriod: Number(period),
          oversold: Number(threshold),
          overbought: Number(overbought),
          multiplier: Number(multiplier),
          initialCapital: Number(initialCapital),
          backtestStartDate: startDate,
          backtestEndDate: endDate,
          syncIfMissing,
          comparison: resp.data,
          asOf: resp.meta?.as_of,
          storageSource: resp.meta?.storage_source ?? resp.meta?.source ?? null,
        })
        if (snapshot) {
          setHistoryItems((current) => {
            const next = [snapshot, ...current].slice(0, 12)
            persistCompareSnapshotHistory(next)
            return next
          })
        }
        setPendingCompareSnapshot(null)
      }
    },
  })
  const taskQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['backtest-task', activeTaskId],
    queryFn: () => getBacktestTask(activeTaskId ?? ''),
    enabled: Boolean(activeTaskId),
    refetchInterval: (query) => {
      const status = String((query.state.data as { data?: { status?: string } } | undefined)?.data?.status ?? '').toLowerCase()
      return status && !['completed', 'success', 'done', 'failed', 'error', 'cancelled'].includes(status) ? 2000 : false
    },
  })

  const strategies = strategiesQuery.data?.data ?? []
  const strategyMeta = useMemo(
    () => strategies.find((item) => item.name === strategyName),
    [strategies, strategyName],
  )
  const parameterMode = useMemo(
    () => strategyMeta?.parameter_mode ?? fallbackStrategyMode(strategyName),
    [strategyMeta, strategyName],
  )
  const parameterInputs = useMemo(
    () => ({
      fast: Number(fast),
      slow: Number(slow),
      period: Number(period),
      oversold: Number(threshold),
      overbought: Number(overbought),
      threshold: Number(threshold),
      multiplier: Number(multiplier),
    }),
    [fast, multiplier, overbought, period, slow, threshold],
  )
  const parameterPayload = useMemo(
    () => buildStrategyParameters(strategyName, parameterInputs),
    [parameterInputs, strategyName],
  )
  const compareStrategyNames = useMemo(
    () => Array.from(new Set<BacktestStrategyName>([strategyName, ...comparisonPool])),
    [comparisonPool, strategyName],
  )
  const compareParametersByStrategy = useMemo(
    () =>
      compareStrategyNames.reduce<Record<string, Record<string, number>>>((accumulator, name) => {
        const parameters = buildStrategyParameters(name, parameterInputs)
        if (Object.keys(parameters).length > 0) {
          accumulator[name] = parameters
        }
        return accumulator
      }, {}),
    [compareStrategyNames, parameterInputs],
  )

  const runPayload = runMutation.data?.data
  const compareDataPayload = compareMutation.data?.data
  const immediateRunResponse = isRunDataPayload(runPayload) ? runMutation.data ?? null : null
  const immediateCompareResponse = Array.isArray(compareDataPayload) ? compareMutation.data ?? null : null
  const effectiveRunResponse = resolvedRunResponse ?? immediateRunResponse
  const effectiveCompareResponse = resolvedCompareResponse ?? immediateCompareResponse
  const runData = effectiveRunResponse && isRunDataPayload(effectiveRunResponse.data) ? effectiveRunResponse.data : null
  const runMeta = effectiveRunResponse?.meta
  const compareCurves = Array.isArray(effectiveCompareResponse?.curves) ? effectiveCompareResponse.curves : []
  const compareMeta = effectiveCompareResponse?.meta
  const runError = runMutation.error ? extractApiError(runMutation.error, 'failed to run backtest') : null
  const compareError = compareMutation.error ? extractApiError(compareMutation.error, 'failed to compare strategies') : null
  const strategiesError = strategiesQuery.error ? extractApiError(strategiesQuery.error, 'failed to load strategy catalog') : null
  const taskError = taskQuery.error ? extractApiError(taskQuery.error, 'failed to load backtest task') : null
  const queuedRunState = isAsyncTaskPayload(runPayload) ? runPayload : null
  const queuedCompareState = isAsyncTaskPayload(compareDataPayload) ? compareDataPayload : null
  const activeTaskStatus =
    taskQuery.data?.data?.status ??
    (activeTaskKind === 'run' ? queuedRunState?.status : activeTaskKind === 'compare' ? queuedCompareState?.status : null) ??
    null
  const activeTaskStatusNormalized = String(activeTaskStatus ?? '').toLowerCase()
  const isActiveTaskRunning =
    Boolean(activeTaskId) &&
    Boolean(activeTaskStatusNormalized) &&
    !['completed', 'success', 'done', 'failed', 'error', 'cancelled'].includes(activeTaskStatusNormalized)
  const activeResolvedTaskKind = taskQuery.data?.data?.task_kind ?? activeTaskKind
  const activeTaskError = taskQuery.data?.data?.error
  const drawdownCurve = useMemo(() => buildDrawdownCurve(runData?.equity_curve ?? []), [runData?.equity_curve])
  const monthlyHeatmap = useMemo(() => buildMonthlyHeatmap(runData?.equity_curve ?? []), [runData?.equity_curve])
  const comparisonRows = Array.isArray(effectiveCompareResponse?.data) ? effectiveCompareResponse.data : []
  const bestCandidate = comparisonRows[0]
  const primaryCurveSeries = useMemo(
    () => [
      {
        id: 'portfolio',
        label: 'Portfolio',
        color: '#0f89c9',
        points: (runData?.equity_curve ?? []).map((point) => ({ date: point.date, value: point.value })),
      },
      {
        id: 'benchmark',
        label: 'Benchmark',
        color: '#f97316',
        points: (runData?.benchmark_curve ?? []).map((point) => ({ date: point.date, value: point.value })),
      },
    ].filter((item) => item.points.length > 0),
    [runData?.benchmark_curve, runData?.equity_curve],
  )
  const compareCurveSeries = useMemo(
    () =>
      compareCurves.map((curve, index) => ({
        id: curve.strategy_name ?? `${curve.label}-${index}`,
        label: curve.label,
        points: curve.points,
      })),
    [compareCurves],
  )

  useEffect(() => {
    const taskData = taskQuery.data?.data
    if (!taskData?.task_id || !taskData.status) return
    if (lastHandledTaskId === taskData.task_id && ['completed', 'failed'].includes(String(taskData.status))) return
    const taskKind = taskData.task_kind ?? activeTaskKind
    if (taskData.status === 'completed' && taskData.result_payload) {
      if (taskKind === 'run' && isBacktestRunResponsePayload(taskData.result_payload)) {
        setResolvedRunResponse(taskData.result_payload)
      }
      if (taskKind === 'compare' && isBacktestCompareResponsePayload(taskData.result_payload)) {
        setResolvedCompareResponse(taskData.result_payload)
        if (pendingCompareSnapshot) {
          const snapshot = buildCompareSnapshot({
            ...pendingCompareSnapshot,
            comparison: Array.isArray(taskData.result_payload.data) ? taskData.result_payload.data : [],
            asOf: taskData.result_payload.meta?.as_of,
            storageSource: taskData.result_payload.meta?.storage_source ?? taskData.result_payload.meta?.source ?? null,
          })
          if (snapshot) {
            setHistoryItems((current) => {
              const next = [snapshot, ...current].slice(0, 12)
              persistCompareSnapshotHistory(next)
              return next
            })
          }
          setPendingCompareSnapshot(null)
        }
      }
      setLastHandledTaskId(taskData.task_id)
      return
    }
    if (taskData.status === 'failed') {
      if (taskKind === 'compare') {
        setPendingCompareSnapshot(null)
      }
      setLastHandledTaskId(taskData.task_id)
    }
  }, [activeTaskKind, lastHandledTaskId, pendingCompareSnapshot, taskQuery.data])

  const resultCanvasReady =
    !isActiveTaskRunning &&
    (primaryCurveSeries.length > 0 ||
      compareCurveSeries.length > 0 ||
      comparisonRows.length > 0 ||
      Object.keys(runData?.metrics ?? {}).length > 0 ||
      (runData?.trades ?? []).length > 0 ||
      monthlyHeatmap.length > 0)

  const toggleCompareStrategy = (name: BacktestStrategyName) => {
    setComparisonPool((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : current.length >= 8 ? current : [...current, name],
    )
  }

  const applyTemplate = (templateValue: (typeof COMPARE_STRATEGY_TEMPLATES)[number]['value']) => {
    const template = COMPARE_STRATEGY_TEMPLATES.find((item) => item.value === templateValue)
    if (!template) return
    if (template.value === 'current_only') {
      setComparisonPool([])
      return
    }
    setComparisonPool(template.strategies)
  }

  const adoptBestCandidate = () => {
    if (!bestCandidate) return
    setPreviousStrategy(strategyName)
    setStrategyName(bestCandidate.strategy_name)
  }

  const applyHistoryItem = (item: CompareSnapshotHistoryItem) => {
    setSymbol(item.symbol)
    setAssetType(item.assetType)
    setStrategyName(item.strategyName)
    setComparisonPool(item.compareStrategyNames.filter((name) => name !== item.strategyName))
    setRankingMetric(item.compareRankingMetric)
    setFast(String(item.fast))
    setSlow(String(item.slow))
    setPeriod(String(item.rsiPeriod))
    setThreshold(String(item.oversold))
    setOverbought(String(item.overbought))
    setMultiplier(String(item.multiplier))
    setInitialCapital(String(item.initialCapital))
    setStartDate(item.backtestStartDate)
    setEndDate(item.backtestEndDate)
    setSyncIfMissing(item.syncIfMissing)
  }

  return (
    <div id="workspace-backtest" data-page="backtest-workbench" className="grid gap-6 xl:grid-cols-[minmax(320px,0.84fr)_minmax(0,1.16fr)]">
      <Card data-layout-role="secondary" className="self-start p-6 xl:sticky xl:top-4">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-cyan-600" />
                Run Controls
              </CardTitle>
              <CardDescription>Keep symbol, parameters, compare pool, and execution controls in one place. This rail sets up the experiment and stays out of the result canvas.</CardDescription>
            </div>
            <Badge tone="default">{parameterMode}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {strategiesError ? <InlineError message={strategiesError} /> : null}
          {runError ? <InlineError message={runError} /> : null}
          {compareError ? <InlineError message={compareError} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="symbol" />
            <select className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={assetType} onChange={(event) => setAssetType(event.target.value as 'stock' | 'crypto')}>
              <option value="stock">stock</option>
              <option value="crypto">crypto</option>
            </select>
          </div>
          <select className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={strategyName} onChange={(event) => setStrategyName(event.target.value as BacktestStrategyName)}>
            {strategies.map((item) => (
              <option key={item.name} value={item.name}>{item.label}</option>
            ))}
          </select>

          {(parameterMode === 'fast_slow' || isFastSlowStrategy(strategyName)) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={fast} onChange={(event) => setFast(event.target.value)} placeholder={getFastLabel(strategyName)} />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={slow} onChange={(event) => setSlow(event.target.value)} placeholder={getSlowLabel(strategyName)} />
            </div>
          ) : null}
          {(parameterMode === 'oscillator' || isOscillatorStrategy(strategyName)) ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={period} onChange={(event) => setPeriod(event.target.value)} placeholder={getOscillatorPeriodLabel(strategyName)} />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="Oversold" />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={overbought} onChange={(event) => setOverbought(event.target.value)} placeholder="Overbought" />
            </div>
          ) : null}
          {strategyName === 'cci_reversal' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="CCI Period" />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="Oversold" />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={overbought} onChange={(event) => setOverbought(event.target.value)} placeholder="Overbought" />
            </div>
          ) : null}
          {(parameterMode === 'threshold' || isThresholdStrategy(strategyName)) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={period} onChange={(event) => setPeriod(event.target.value)} placeholder={getThresholdLabels(strategyName).period} />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder={getThresholdLabels(strategyName).threshold} />
            </div>
          ) : null}
          {strategyName === 'bollinger_reversion' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="Band Period" />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} placeholder="Std Dev" />
            </div>
          ) : null}
          {(parameterMode === 'period_multiplier' || isPeriodMultiplierStrategy(strategyName)) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={period} onChange={(event) => setPeriod(event.target.value)} placeholder={strategyName === 'supertrend_follow' ? 'ATR Period' : 'Channel Period'} />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} placeholder="Multiplier" />
            </div>
          ) : null}
          {(strategyName === 'vwap_reversion' || strategyName === 'atr_breakout') ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={period} onChange={(event) => setPeriod(event.target.value)} placeholder={strategyName === 'vwap_reversion' ? 'VWAP Period' : 'ATR Period'} />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={multiplier} onChange={(event) => setMultiplier(event.target.value)} placeholder={strategyName === 'vwap_reversion' ? 'Deviation %' : 'Multiplier'} />
            </div>
          ) : null}
          {strategyName === 'donchian_breakout' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={fast} onChange={(event) => setFast(event.target.value)} placeholder="Breakout Lookback" />
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={slow} onChange={(event) => setSlow(event.target.value)} placeholder="Exit Lookback" />
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={initialCapital} onChange={(event) => setInitialCapital(event.target.value)} placeholder="Initial Capital" />
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <input type="checkbox" checked={syncIfMissing} onChange={(event) => setSyncIfMissing(event.target.checked)} />
            auto sync missing OHLCV
          </label>

          <div className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-950">Compare pool</p>
              <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={rankingMetric} onChange={(event) => setRankingMetric(event.target.value as BacktestCompareRankingMetric)}>
                <option value="total_return">total_return</option>
                <option value="annual_return">annual_return</option>
                <option value="sharpe_ratio">sharpe_ratio</option>
                <option value="max_drawdown">max_drawdown</option>
                <option value="win_rate">win_rate</option>
                <option value="trade_count">trade_count</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              {COMPARE_STRATEGY_TEMPLATES.map((template) => (
                <Button key={template.value} variant="chip" size="sm" onClick={() => applyTemplate(template.value)}>
                  {template.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-slate-500">The current strategy is always included in the compare pool.</p>
            <div className="flex flex-wrap gap-2">
              {strategies.slice(0, 16).map((item) => (
                <Button
                  key={item.name}
                  variant={comparisonPool.includes(item.name) ? 'primary' : 'chip'}
                  size="sm"
                  onClick={() => toggleCompareStrategy(item.name)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending || isActiveTaskRunning}>
              <Play className="h-4 w-4" />
              {runMutation.isPending || (isActiveTaskRunning && activeTaskKind === 'run') ? 'Running' : 'Run Backtest'}
            </Button>
            <Button variant="secondary" onClick={() => compareMutation.mutate()} disabled={compareMutation.isPending || isActiveTaskRunning}>
              <ScanLine className="h-4 w-4" />
              {compareMutation.isPending || (isActiveTaskRunning && activeTaskKind === 'compare') ? 'Comparing' : 'Compare Pool'}
            </Button>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4 text-sm text-slate-600">
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge tone={taskTone(activeTaskStatus)}>{displayText(activeTaskStatus, activeTaskId ? 'queued' : 'not_started')}</Badge>
              <Badge tone="muted">{displayText(activeResolvedTaskKind, 'idle')}</Badge>
              <Badge tone="muted">{activeTaskId ? (taskQuery.isFetching ? 'polling' : 'task tracked') : 'no active task'}</Badge>
            </div>
            <p>task_id {displayText(activeTaskId, 'none')}</p>
            <p>task_status {displayText(activeTaskStatus, activeTaskId ? 'queued' : 'not_started')}</p>
            <p>task_kind {displayText(activeResolvedTaskKind, 'none')}</p>
            {queuedRunState ? <p>run_request_status {displayText(queuedRunState.status, 'queued')}</p> : null}
            {queuedCompareState ? <p>compare_request_status {displayText(queuedCompareState.status, 'queued')}</p> : null}
            {taskError ? <p className="text-rose-600">{taskError}</p> : null}
            {activeTaskError ? <p className="text-rose-600">{activeTaskError}</p> : null}
          </div>
        </CardContent>
      </Card>

      <div data-layout-role="primary" className="grid gap-6">
        <Card className="p-6">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-cyan-600" />
                  Result Canvas
                </CardTitle>
                <CardDescription>Read one experiment loop at a time here: curves, compare output, and run detail live in a single canvas instead of multiple competing columns.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="default">{runData?.equity_curve?.length ?? 0} points</Badge>
                {bestCandidate ? <Badge tone="positive">best {bestCandidate.label}</Badge> : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {runError ? <InlineError message={runError} /> : null}
            {compareError ? <InlineError message={compareError} /> : null}
            {!resultCanvasReady ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white/65 p-5 text-sm leading-7 text-slate-500">
                {runError || compareError
                  ? 'The latest run/compare request failed. Fix the request or data source issue, then retry to populate the result canvas.'
                  : activeTaskStatus === 'queued'
                    ? 'The current backtest task is queued. Keep this page open while the worker picks it up.'
                    : activeTaskStatus === 'running'
                      ? 'The current backtest task is running. The result canvas will populate automatically when the task completes.'
                      : activeTaskStatus === 'failed'
                        ? 'The current backtest task failed before producing a result. Inspect the task error, then retry.'
                  : 'Run a backtest or compare pool to populate the result canvas. This page keeps a single empty state here so the controls rail can stay focused on setup.'}
              </div>
            ) : (
              <>
                <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.06fr)_minmax(320px,0.94fr)]">
                  <div className="grid gap-5">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
                      <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                        <div className="mb-3 flex flex-wrap gap-2">
                          {primaryCurveSeries.map((item) => (
                            <Badge key={item.id} tone={item.id === 'portfolio' ? 'default' : 'warning'}>
                              {item.label}
                            </Badge>
                          ))}
                        </div>
                        <EquityCurve series={primaryCurveSeries} height={320} />
                      </div>
                      <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                        <p className="mb-3 text-sm font-semibold text-slate-950">Drawdown</p>
                        <EquityCurve points={drawdownCurve} height={320} />
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-white/80 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">Compare readout</p>
                          <p className="mt-1 text-sm text-slate-500">Keep the ranking table, overlay, and strategy adoption controls together so compare decisions happen in one place.</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <Button variant="secondary" onClick={adoptBestCandidate} disabled={!bestCandidate}>
                            采用最佳候选
                          </Button>
                          <Button variant="chip" onClick={() => previousStrategy && setStrategyName(previousStrategy)} disabled={!previousStrategy}>
                            <RotateCcw className="h-4 w-4" />
                            Undo strategy switch
                          </Button>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.02fr)_minmax(300px,0.98fr)]">
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 text-slate-400">
                                <th className="pb-3 pr-4 font-medium">Strategy</th>
                                <th className="pb-3 pr-4 font-medium">Total</th>
                                <th className="pb-3 pr-4 font-medium">Annual</th>
                                <th className="pb-3 pr-4 font-medium">Sharpe</th>
                                <th className="pb-3 pr-4 font-medium">Drawdown</th>
                                <th className="pb-3 pr-4 font-medium">Trades</th>
                              </tr>
                            </thead>
                            <tbody>
                              {comparisonRows.map((row) => (
                                <tr key={row.strategy_name} className="border-b border-slate-100 last:border-0">
                                  <td className="py-3 pr-4 text-slate-950">{row.label}</td>
                                  <td className={cn('py-3 pr-4', row.total_return >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{displayPercent(row.total_return)}</td>
                                  <td className="py-3 pr-4 text-slate-700">{displayPercent(row.annual_return)}</td>
                                  <td className="py-3 pr-4 text-slate-700">{displayFixed(row.sharpe_ratio, 2)}</td>
                                  <td className="py-3 pr-4 text-slate-700">{displayPercent(row.max_drawdown)}</td>
                                  <td className="py-3 pr-4 text-slate-700">{row.trade_count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                          <div className="mb-3 flex flex-wrap gap-2">
                            {compareCurveSeries.map((item) => (
                              <Badge key={item.id} tone="muted">
                                {item.label}
                              </Badge>
                            ))}
                            {compareCurveSeries.length === 0 ? <Badge tone="muted">no compare overlay yet</Badge> : null}
                          </div>
                          <EquityCurve series={compareCurveSeries} height={220} />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-5">
                    <div className="rounded-3xl border border-slate-200 bg-white/80 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-950">Run detail</p>
                          <p className="mt-1 text-sm text-slate-500">Metrics, runtime metadata, and tabbed detail stay in one detail rail.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant={resultTab === 'trades' ? 'primary' : 'chip'} size="sm" onClick={() => setResultTab('trades')}>
                            交易记录
                          </Button>
                          <Button variant={resultTab === 'monthly' ? 'primary' : 'chip'} size="sm" onClick={() => setResultTab('monthly')}>
                            月度热力图
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {Object.entries(runData?.metrics ?? {}).map(([key, value]) => (
                          <div key={key} className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                            <p className="text-xs uppercase tracking-widest text-slate-400">{key}</p>
                            <p className="mt-2 font-semibold text-slate-950">{typeof value === 'number' ? displayFixed(value, 4) : displayText(value)}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Badge tone="default">{displayText(runMeta?.storage_source, 'pending')}</Badge>
                        <Badge tone={runMeta?.coverage_complete ? 'positive' : 'warning'}>coverage {String(Boolean(runMeta?.coverage_complete))}</Badge>
                        <Badge tone="muted">{displayText(runMeta?.provider, 'provider')}</Badge>
                        <Badge tone="muted">source {displayText(runMeta?.source ?? runMeta?.ohlcv_source, 'unknown')}</Badge>
                        <Badge tone={runMeta?.stale ? 'warning' : 'positive'}>stale {String(Boolean(runMeta?.stale))}</Badge>
                        <Badge tone="muted">as_of {displayText(runMeta?.as_of, 'n/a')}</Badge>
                      </div>
                      <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50/90 p-4 text-sm text-slate-600">
                        <p>compare source {displayText(compareMeta?.source ?? compareMeta?.storage_source, 'n/a')}</p>
                        <p>compare stale {String(Boolean(compareMeta?.stale))}</p>
                        <p>compare as_of {displayText(compareMeta?.as_of, 'n/a')}</p>
                      </div>
                      <div className="mt-4">
                        {resultTab === 'trades' ? (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                              <thead>
                                <tr className="border-b border-slate-200 text-slate-400">
                                  <th className="pb-3 pr-4 font-medium">Date</th>
                                  <th className="pb-3 pr-4 font-medium">Action</th>
                                  <th className="pb-3 pr-4 font-medium">Price</th>
                                  <th className="pb-3 pr-4 font-medium">Shares</th>
                                  <th className="pb-3 pr-4 font-medium">PnL</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(runData?.trades ?? []).slice(0, 20).map((trade: BacktestTrade, index) => (
                                  <tr key={`${trade.date}-${trade.action}-${index}`} className="border-b border-slate-100 last:border-0">
                                    <td className="py-3 pr-4 text-slate-500">{trade.date}</td>
                                    <td className="py-3 pr-4 text-slate-700">{trade.action}</td>
                                    <td className="py-3 pr-4 text-slate-700">{displayFixed(trade.price)}</td>
                                    <td className="py-3 pr-4 text-slate-700">{displayFixed(trade.shares, 2)}</td>
                                    <td className={cn('py-3 pr-4', trade.pnl && trade.pnl < 0 ? 'text-rose-600' : 'text-emerald-600')}>{displayFixed(trade.pnl)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            {monthlyHeatmap.map((item) => (
                              <div key={item.month} className={cn('rounded-2xl p-4', item.returnPct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
                                <p className="text-xs uppercase tracking-widest">{item.month}</p>
                                <p className="mt-2 font-semibold">{displayPercent(item.returnPct)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">Recent snapshots</p>
                        <Badge tone="muted">{historyItems.length}</Badge>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {historyItems.slice(0, 4).map((item) => (
                          <button
                            key={`${item.symbol}-${item.createdAt}-compact`}
                            type="button"
                            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-sm transition hover:border-cyan-200"
                            onClick={() => applyHistoryItem(item)}
                          >
                            {item.symbol} · {item.bestStrategyLabel}
                          </button>
                        ))}
                        {historyItems.length === 0 ? <p className="text-sm text-slate-500">No compare snapshot history yet.</p> : null}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-layout-role="tertiary" className="p-6 xl:col-span-2">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-cyan-600" />
                Experiment Memory
              </CardTitle>
              <CardDescription>Persist useful compare snapshots here so you can restore prior setups without cluttering the main result canvas.</CardDescription>
            </div>
            <Button variant="chip" size="sm" onClick={() => { clearCompareSnapshotHistoryStorage(); setHistoryItems([]) }}>
              clear
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(280px,0.92fr)]">
          <div className="grid gap-3">
            {historyItems.map((item) => (
              <button
                key={`${item.symbol}-${item.createdAt}`}
                type="button"
                className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4 text-left transition hover:border-cyan-200 hover:bg-cyan-50/30"
                onClick={() => applyHistoryItem(item)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{item.symbol}</Badge>
                  <Badge tone="warning">{item.bestStrategyLabel}</Badge>
                  {item.currentRank ? <Badge tone="muted">current rank {item.currentRank}</Badge> : null}
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-500">
                  {item.backtestStartDate} → {item.backtestEndDate} · {item.compareRankingMetric}
                </p>
              </button>
            ))}
            {historyItems.length === 0 ? <p className="text-sm text-slate-500">No compare snapshot history yet.</p> : null}
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
            <p className="text-xs uppercase tracking-widest text-slate-400">Current loop</p>
            <div className="mt-3 grid gap-2 text-sm text-slate-600">
              <p>symbol {symbol.trim().toUpperCase()}</p>
              <p>strategy {displayText(strategyName)}</p>
              <p>compare pool {compareStrategyNames.length}</p>
              <p>ranking {rankingMetric}</p>
              <p>run source {displayText(runMeta?.source ?? runMeta?.storage_source, 'pending')}</p>
              <p>compare source {displayText(compareMeta?.source ?? compareMeta?.storage_source, 'pending')}</p>
              <p>best candidate {displayText(bestCandidate?.label, 'none')}</p>
              <p>previous strategy {displayText(previousStrategy, 'none')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
