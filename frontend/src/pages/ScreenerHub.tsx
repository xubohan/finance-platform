import { useMutation, useQuery } from '@tanstack/react-query'
import { ListFilter, PanelRightOpen, Play, Radar, SearchCheck, ShieldPlus, SlidersHorizontal } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  extractBacktestTaskId,
  getBacktestTask,
  runBacktestLab,
  type BacktestAsyncState,
  type BacktestLabResponse,
  type BacktestLabRow,
  type BacktestTaskKind,
} from '../api/backtest'
import { extractApiError } from '../api/client'
import { getKline, toCandles } from '../api/market'
import { getScreenerSymbols, runScreener } from '../api/screener'
import { addWatchlistItem } from '../api/watchlist'
import KlineChart from '../components/chart/KlineChart'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { BACKGROUND_REFRESH_QUERY_OPTIONS, QUERY_REFRESH_MS } from '../lib/query-refresh'
import { cn } from '../lib/utils'
import type { BacktestStrategyName } from '../utils/backtestStrategies'
import { displayFixed, displayLocaleNumber, displayPercent, displayText } from '../utils/display'
import { formatAsOf, toDateInputLocal, yearsAgo } from '../utils/time'

type MarketChoice = 'us' | 'cn'

function InlineError({ message }: { message: string }) {
  return <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
}

function isAsyncTaskPayload(value: unknown): value is BacktestAsyncState {
  if (!value || typeof value !== 'object') return false
  return 'task_id' in (value as Record<string, unknown>) || 'status' in (value as Record<string, unknown>)
}

function isBacktestLabResponsePayload(value: unknown): value is BacktestLabResponse {
  if (!value || typeof value !== 'object') return false
  return Array.isArray((value as { data?: unknown }).data)
}

function taskTone(status?: string | null): 'positive' | 'warning' | 'negative' | 'muted' {
  if (status === 'completed') return 'positive'
  if (status === 'failed') return 'negative'
  if (status === 'queued' || status === 'running') return 'warning'
  return 'muted'
}

export default function ScreenerPage() {
  const [market, setMarket] = useState<MarketChoice>('us')
  const [minPe, setMinPe] = useState('5')
  const [maxPe, setMaxPe] = useState('40')
  const [minRoe, setMinRoe] = useState('10')
  const [minGrowth, setMinGrowth] = useState('8')
  const [minMarketCap, setMinMarketCap] = useState('2000000000')
  const [maxMarketCap, setMaxMarketCap] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [backtestStrategy, setBacktestStrategy] = useState<BacktestStrategyName>('ema_cross')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [inspectSymbol, setInspectSymbol] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [batchTaskId, setBatchTaskId] = useState<string | null>(null)
  const [batchTaskKind, setBatchTaskKind] = useState<BacktestTaskKind | null>(null)
  const [resolvedBatchBacktestResponse, setResolvedBatchBacktestResponse] = useState<BacktestLabResponse | null>(null)
  const [lastHandledBatchTaskId, setLastHandledBatchTaskId] = useState<string | null>(null)

  const deferredMarket = useDeferredValue(market)
  const deferredFilters = useDeferredValue({ minPe, maxPe, minRoe, minGrowth, minMarketCap, maxMarketCap })

  const screenerQuery = useQuery({
    queryKey: ['screener-run', deferredMarket, deferredFilters, page],
    queryFn: () =>
      runScreener({
        market: deferredMarket,
        min_pe: Number(deferredFilters.minPe),
        max_pe: Number(deferredFilters.maxPe),
        min_roe: Number(deferredFilters.minRoe),
        min_profit_yoy: Number(deferredFilters.minGrowth),
        symbol_limit: 200,
        page_size: 50,
        page,
      }),
    refetchInterval: QUERY_REFRESH_MS.screener,
  })
  const universeQuery = useQuery({
    queryKey: ['screener-universe', deferredMarket],
    queryFn: () => getScreenerSymbols({ market: deferredMarket, limit: 12 }),
    refetchInterval: QUERY_REFRESH_MS.screener,
  })

  const watchlistMutation = useMutation({
    mutationFn: async (symbols: string[]) =>
      Promise.all(
        symbols.map((symbol) =>
          addWatchlistItem({
            symbol,
            asset_type: 'stock',
          }).catch(() => null),
        ),
      ),
  })

  const backtestMutation = useMutation({
    mutationFn: () =>
      runBacktestLab({
        market,
        symbols: selected,
        strategy_name: backtestStrategy,
        parameters: backtestStrategy === 'ema_cross' ? { fast: 8, slow: 21 } : { fast: 5, slow: 20 },
        start_date: yearsAgo(1),
        end_date: toDateInputLocal(new Date()),
        initial_capital: 1_000_000,
        page_size: 50,
      }, { asyncMode: true }),
    onMutate: () => {
      setBatchTaskId(null)
      setBatchTaskKind('lab')
      setResolvedBatchBacktestResponse(null)
      setLastHandledBatchTaskId(null)
    },
    onSuccess: (resp) => {
      const taskId = extractBacktestTaskId(resp)
      if (taskId) {
        setBatchTaskId(taskId)
        return
      }
      setBatchTaskId(null)
      if (Array.isArray(resp.data)) {
        setResolvedBatchBacktestResponse(resp)
      }
    },
  })

  const inspectKlineQuery = useQuery({
    queryKey: ['screener-inspect-kline', inspectSymbol],
    queryFn: () => getKline(inspectSymbol ?? '', '1d'),
    enabled: Boolean(inspectSymbol),
    refetchInterval: QUERY_REFRESH_MS.marketContext,
  })

  const items = screenerQuery.data?.data ?? []
  const screenerMeta = screenerQuery.data?.meta
  const universeRows = universeQuery.data?.data ?? []
  const universeMeta = universeQuery.data?.meta
  const screenerError = screenerQuery.error instanceof Error ? screenerQuery.error.message : null
  const universeError = universeQuery.error ? extractApiError(universeQuery.error, 'failed to load screener universe') : null
  const watchlistActionError = watchlistMutation.error instanceof Error ? watchlistMutation.error.message : null
  const batchBacktestError = backtestMutation.error ? extractApiError(backtestMutation.error, 'failed to run batch backtest') : null
  const inspectKlineError = inspectKlineQuery.error instanceof Error ? inspectKlineQuery.error.message : null
  const batchTaskQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['screener-batch-backtest-task', batchTaskId],
    queryFn: () => getBacktestTask(batchTaskId ?? ''),
    enabled: Boolean(batchTaskId),
    refetchInterval: (query) => {
      const status = String((query.state.data as { data?: { status?: string } } | undefined)?.data?.status ?? '').toLowerCase()
      return status && !['completed', 'success', 'done', 'failed', 'error', 'cancelled'].includes(status) ? 2000 : false
    },
  })
  const scoredRows = useMemo(
    () =>
      items
        .filter((item) => {
          if ((item.market_cap ?? 0) < Number(minMarketCap || 0)) return false
          if (maxMarketCap && (item.market_cap ?? 0) > Number(maxMarketCap)) return false
          return true
        })
        .map((item) => ({
          ...item,
          score: Math.round(((item.roe ?? 0) * 0.45) + ((item.profit_yoy ?? 0) * 0.35) + Math.max(0, 30 - (item.pe_ttm ?? 30)) * 0.2),
        })),
    [items, maxMarketCap, minMarketCap],
  )
  const selectedRows = scoredRows.filter((row) => selected.includes(row.symbol))
  const inspectRow = scoredRows.find((row) => row.symbol === inspectSymbol) ?? null
  const inspectCandles = toCandles(inspectKlineQuery.data?.data ?? [])
  const inspectKlineMeta = inspectKlineQuery.data?.meta
  const batchBacktestPayload = backtestMutation.data?.data
  const immediateBatchBacktestResponse = Array.isArray(batchBacktestPayload) ? backtestMutation.data ?? null : null
  const effectiveBatchBacktestResponse = resolvedBatchBacktestResponse ?? immediateBatchBacktestResponse
  const batchBacktestRows = Array.isArray(effectiveBatchBacktestResponse?.data) ? effectiveBatchBacktestResponse.data : []
  const bestBacktestRow = batchBacktestRows[0] as BacktestLabRow | undefined
  const backtestMeta = effectiveBatchBacktestResponse?.meta ?? backtestMutation.data?.meta
  const queuedBatchState = isAsyncTaskPayload(batchBacktestPayload) ? batchBacktestPayload : null
  const batchTaskStatus = taskTone(
    batchTaskQuery.data?.data?.status ?? queuedBatchState?.status ?? null,
  )
  const batchTaskStatusText = batchTaskQuery.data?.data?.status ?? queuedBatchState?.status ?? null
  const batchTaskResolvedKind = batchTaskQuery.data?.data?.task_kind ?? batchTaskKind
  const batchTaskErrorMessage = batchTaskQuery.data?.data?.error
  const batchTaskRequestError = batchTaskQuery.error ? extractApiError(batchTaskQuery.error, 'failed to load batch backtest task') : null

  const toggleSelected = (symbol: string) => {
    setSelected((current) => (current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol]))
  }
  useEffect(() => {
    setPage(1)
  }, [market, maxMarketCap, maxPe, minGrowth, minMarketCap, minPe, minRoe])

  useEffect(() => {
    const taskData = batchTaskQuery.data?.data
    if (!taskData?.task_id || !taskData.status) return
    if (lastHandledBatchTaskId === taskData.task_id && ['completed', 'failed'].includes(String(taskData.status))) return
    const taskKind = taskData.task_kind ?? batchTaskKind
    if (taskData.status === 'completed' && taskKind === 'lab' && taskData.result_payload && isBacktestLabResponsePayload(taskData.result_payload)) {
      setResolvedBatchBacktestResponse(taskData.result_payload)
      setLastHandledBatchTaskId(taskData.task_id)
      return
    }
    if (taskData.status === 'failed') {
      setLastHandledBatchTaskId(taskData.task_id)
    }
  }, [batchTaskKind, batchTaskQuery.data, lastHandledBatchTaskId])

  const openInspectDrawer = (symbol: string) => {
    setInspectSymbol(symbol)
    setDrawerOpen(true)
  }

  return (
    <div data-page="screener-hub" className="grid gap-6 xl:grid-cols-[minmax(0,1.16fr)_minmax(340px,0.84fr)]">
      <div data-layout-role="primary" className="grid min-w-0 gap-6">
        <Card className="p-6">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ListFilter className="h-5 w-5 text-cyan-600" />
                  Screener Controls
                </CardTitle>
                <CardDescription>Shape the universe first. The shortlist below should stay visually primary, while the drawer opens only when you want to act.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="default">{market.toUpperCase()}</Badge>
                <Button variant={drawerOpen ? 'secondary' : 'chip'} size="sm" onClick={() => setDrawerOpen((value) => !value)}>
                  <SlidersHorizontal className="h-4 w-4" />
                  {drawerOpen ? 'Hide Drawer' : 'Open Drawer'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {screenerError ? <InlineError message={`Screener request failed: ${screenerError}`} /> : null}
            <div className="grid gap-3 xl:grid-cols-[minmax(0,0.62fr)_minmax(0,1.38fr)]">
              <label className="grid gap-2 text-sm text-slate-500">
                Market
                <select className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={market} onChange={(event) => setMarket(event.target.value as MarketChoice)}>
                  <option value="us">US</option>
                  <option value="cn">CN</option>
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="grid gap-2 text-sm text-slate-500">
                  Min PE
                  <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={minPe} onChange={(event) => setMinPe(event.target.value)} />
                </label>
                <label className="grid gap-2 text-sm text-slate-500">
                  Max PE
                  <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={maxPe} onChange={(event) => setMaxPe(event.target.value)} />
                </label>
                <label className="grid gap-2 text-sm text-slate-500">
                  Min ROE
                  <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={minRoe} onChange={(event) => setMinRoe(event.target.value)} />
                </label>
                <label className="grid gap-2 text-sm text-slate-500">
                  Min Growth
                  <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={minGrowth} onChange={(event) => setMinGrowth(event.target.value)} />
                </label>
                <label className="grid gap-2 text-sm text-slate-500">
                  Min Market Cap (local)
                  <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={minMarketCap} onChange={(event) => setMinMarketCap(event.target.value)} />
                </label>
                <label className="grid gap-2 text-sm text-slate-500">
                  Max Market Cap (local)
                  <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={maxMarketCap} onChange={(event) => setMaxMarketCap(event.target.value)} placeholder="optional" />
                </label>
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)_minmax(280px,0.88fr)]">
              <div className="rounded-3xl border border-slate-200 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-widest text-slate-400">Universe Snapshot</p>
                <p className="mt-2 text-sm leading-7 text-slate-500">
                  This is the live symbol universe returned by <code>/screener/symbols</code> before the shortlist run narrows candidates.
                </p>
                {universeError ? <InlineError message={`Universe request failed: ${universeError}`} /> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={universeMeta?.stale ? 'warning' : 'positive'}>{displayText(universeMeta?.source, 'unknown')}</Badge>
                  <Badge tone="muted">count {displayText(universeMeta?.count, universeRows.length)}</Badge>
                  <Badge tone="muted">available {displayText(universeMeta?.total_available, universeRows.length)}</Badge>
                  <Badge tone="muted">{formatAsOf(universeMeta?.as_of)}</Badge>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {universeRows.slice(0, 8).map((row) => (
                    <Badge key={`universe-${row.symbol}`} tone="muted">
                      {row.symbol} · {displayText(row.name, row.market ?? 'n/a')}
                    </Badge>
                  ))}
                  {universeRows.length === 0 && !universeError ? <p className="text-sm text-slate-500">{universeQuery.isFetching ? 'Loading universe snapshot...' : 'No universe rows returned.'}</p> : null}
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                <p className="text-xs uppercase tracking-widest text-slate-400">Live screener contract</p>
                <p className="mt-2 text-sm leading-7 text-slate-500">The shortlist is derived from the live screener response. The drawer stays secondary until you need inspect, watchlist, or batch backtest actions.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={screenerMeta?.stale ? 'warning' : 'positive'}>{displayText(screenerMeta?.source, 'unknown')}</Badge>
                  <Badge tone="muted">{formatAsOf(screenerMeta?.as_of)}</Badge>
                  <Badge tone="muted">stale {String(Boolean(screenerMeta?.stale))}</Badge>
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-widest text-slate-400">Action staging</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone={selected.length > 0 ? 'default' : 'muted'}>{selected.length} selected</Badge>
                  <Badge tone={inspectRow ? 'warning' : 'muted'}>{inspectRow?.symbol ?? 'no inspect symbol'}</Badge>
                  <Badge tone={drawerOpen ? 'positive' : 'muted'}>{drawerOpen ? 'drawer open' : 'drawer collapsed'}</Badge>
                  <Badge tone="muted">page {displayText(screenerMeta?.page, page)} / {displayText(screenerMeta?.total_pages, 1)}</Badge>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-500">Keep the shortlist as the decision surface. Open the drawer when a candidate is worth inspecting or batching.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 p-6">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <SearchCheck className="h-5 w-5 text-cyan-600" />
                  Shortlist
                </CardTitle>
                <CardDescription>Rank candidates here. The page should feel shortlist-first, with inspect and batch actions downstream.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="default">{screenerQuery.isFetching ? 'refreshing' : `local ${scoredRows.length} names`}</Badge>
                <Badge tone={selected.length > 0 ? 'warning' : 'muted'}>{selected.length} selected</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {screenerError ? <InlineError message={`Screener request failed: ${screenerError}`} /> : null}
            <div className="flex flex-wrap gap-2">
              <Badge tone="muted">PE {displayText(minPe)} to {displayText(maxPe)}</Badge>
              <Badge tone="muted">ROE {displayText(minRoe)}+</Badge>
              <Badge tone="muted">Growth {displayText(minGrowth)}+</Badge>
              <Badge tone="warning">MCap local page filter {displayLocaleNumber(minMarketCap)} to {displayText(maxMarketCap || 'open')}</Badge>
              <Badge tone="muted">Quick rank is client-side only</Badge>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-7 text-amber-900">
              Market cap bounds are applied only as a post-filter on the current shortlist page. They are not sent to the live screener API as server-side constraints.
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-7 text-slate-500">
              Quick rank is calculated in the page from ROE, growth, and PE to help eyeball the current response. It is not an official backend scoring contract.
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-400">
                    <th className="pb-3 pr-4 font-medium">Select</th>
                    <th className="pb-3 pr-4 font-medium">Symbol</th>
                    <th className="pb-3 pr-4 font-medium">Name</th>
                    <th className="pb-3 pr-4 font-medium">PE</th>
                    <th className="pb-3 pr-4 font-medium">ROE</th>
                    <th className="pb-3 pr-4 font-medium">Growth</th>
                    <th className="pb-3 pr-4 font-medium">MCap</th>
                    <th className="pb-3 pr-4 font-medium">Quick Rank</th>
                    <th className="pb-3 pr-4 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {scoredRows.map((row) => (
                    <tr
                      key={row.symbol}
                      className={cn(
                        'cursor-pointer border-b border-slate-100 last:border-0',
                        selected.includes(row.symbol) ? 'bg-cyan-50/35' : '',
                        inspectSymbol === row.symbol ? 'bg-slate-100/70' : '',
                      )}
                      onClick={() => openInspectDrawer(row.symbol)}
                    >
                      <td className="py-3 pr-4">
                        <input
                          type="checkbox"
                          checked={selected.includes(row.symbol)}
                          onChange={() => toggleSelected(row.symbol)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </td>
                      <td className="py-3 pr-4 font-medium text-slate-950">{row.symbol}</td>
                      <td className="py-3 pr-4 text-slate-600">{displayText(row.name)}</td>
                      <td className="py-3 pr-4 text-slate-700">{displayFixed(row.pe_ttm)}</td>
                      <td className="py-3 pr-4 text-slate-700">{displayFixed(row.roe)}</td>
                      <td className="py-3 pr-4 text-slate-700">{displayFixed(row.profit_yoy)}</td>
                      <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.market_cap)}</td>
                      <td className="py-3 pr-4">
                        <Badge tone={row.score >= 60 ? 'positive' : row.score >= 40 ? 'warning' : 'muted'}>client {row.score}</Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <button
                          type="button"
                          className="text-cyan-700 hover:text-cyan-900"
                          onClick={(event) => {
                            event.stopPropagation()
                            openInspectDrawer(row.symbol)
                          }}
                        >
                          inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {scoredRows.length === 0 && !screenerQuery.isFetching && !screenerError ? <p className="text-sm text-slate-500">No screener results for current filter.</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                page {displayText(screenerMeta?.page, page)} / {displayText(screenerMeta?.total_pages, 1)} · server total {displayText(screenerMeta?.total_items, items.length)} · local rows {scoredRows.length}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="chip"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || screenerQuery.isFetching}
                >
                  prev
                </Button>
                <Button
                  variant="chip"
                  size="sm"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={
                    screenerQuery.isFetching ||
                    (typeof screenerMeta?.total_pages === 'number' && page >= screenerMeta.total_pages)
                  }
                >
                  next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div data-layout-role="secondary" className="grid gap-6 self-start xl:sticky xl:top-4">
        <Card className="p-6">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <PanelRightOpen className="h-5 w-5 text-cyan-600" />
                  Action Drawer
                </CardTitle>
                <CardDescription>Inspect one selected symbol, stage watchlist actions, and run batch backtests here without competing with the shortlist.</CardDescription>
              </div>
              <Button variant="chip" size="sm" onClick={() => setDrawerOpen((value) => !value)}>
                <SlidersHorizontal className="h-4 w-4" />
                {drawerOpen ? 'Collapse' : 'Expand'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {watchlistActionError ? <InlineError message={`Watchlist action failed: ${watchlistActionError}`} /> : null}
            {batchBacktestError ? <InlineError message={`Batch backtest failed: ${batchBacktestError}`} /> : null}
            {drawerOpen ? (
              <>
                <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-slate-400">Inspect drawer</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">{inspectRow?.symbol ?? 'Select a row'}</p>
                      <p className="text-sm text-slate-500">{displayText(inspectRow?.name, 'Open a shortlist row to inspect the current chart preview with explicit freshness metadata.')}</p>
                    </div>
                    {inspectRow ? <Badge tone={inspectRow.score >= 60 ? 'positive' : inspectRow.score >= 40 ? 'warning' : 'muted'}>client quick rank {inspectRow.score}</Badge> : null}
                  </div>
                  <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-3">
                    {inspectCandles.length > 0 ? (
                      <KlineChart candles={inspectCandles} height={220} secondaryHeight={0} oscillator="none" />
                    ) : (
                      <p className="text-sm text-slate-500">
                        {inspectSymbol
                          ? inspectKlineQuery.isFetching
                            ? 'Loading kline preview...'
                            : 'No kline preview is available for the current freshness contract.'
                          : 'Select one shortlist row to load the current daily preview.'}
                      </p>
                    )}
                    {inspectKlineError ? <InlineError message={`Inspect kline failed: ${inspectKlineError}`} /> : null}
                  </div>
                  {inspectSymbol ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge tone={inspectKlineMeta?.stale ? 'warning' : 'positive'}>{displayText(inspectKlineMeta?.source, 'source n/a')}</Badge>
                      <Badge tone="muted">{displayText(inspectKlineMeta?.provider ?? inspectKlineMeta?.fetch_source, 'provider n/a')}</Badge>
                      <Badge tone="muted">{formatAsOf(inspectKlineMeta?.as_of)}</Badge>
                      <Badge tone="muted">stale {String(Boolean(inspectKlineMeta?.stale))}</Badge>
                    </div>
                  ) : null}
                  {inspectRow ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="secondary">
                        <Link to={`/market/${inspectRow.symbol}`}>Open market page</Link>
                      </Button>
                      <Button size="sm" variant={selected.includes(inspectRow.symbol) ? 'chip' : 'primary'} onClick={() => toggleSelected(inspectRow.symbol)}>
                        {selected.includes(inspectRow.symbol) ? 'Remove from batch' : 'Add to batch'}
                      </Button>
                      <Button size="sm" variant="chip" onClick={() => watchlistMutation.mutate([inspectRow.symbol])} disabled={watchlistMutation.isPending}>
                        <ShieldPlus className="h-4 w-4" />
                        Add watchlist
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {selected.length === 0 ? <Badge tone="muted">No selection</Badge> : selected.map((symbol) => <Badge key={symbol}>{symbol}</Badge>)}
                </div>
                <div className="grid gap-3">
                  <Button variant="secondary" onClick={() => watchlistMutation.mutate(selected)} disabled={selected.length === 0 || watchlistMutation.isPending}>
                    <ShieldPlus className="h-4 w-4" />
                    Add selected to watchlist
                  </Button>
                  <div className="grid gap-2">
                    <label className="text-sm text-slate-500">Batch backtest strategy</label>
                    <select className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" value={backtestStrategy} onChange={(event) => setBacktestStrategy(event.target.value as BacktestStrategyName)}>
                      <option value="ema_cross">EMA Cross</option>
                      <option value="ma_cross">MA Cross</option>
                    </select>
                  </div>
                  <Button
                    onClick={() => backtestMutation.mutate()}
                    disabled={
                      selected.length === 0 ||
                      backtestMutation.isPending ||
                      batchTaskStatusText === 'queued' ||
                      batchTaskStatusText === 'running'
                    }
                  >
                    <Play className="h-4 w-4" />
                    {backtestMutation.isPending || batchTaskStatusText === 'queued' || batchTaskStatusText === 'running'
                      ? 'Running'
                      : 'Run batch backtest'}
                  </Button>
                </div>

                <div className="panel-dark-solid rounded-3xl border border-slate-200 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Radar className="h-4 w-4 text-cyan-300" />
                    <p className="text-sm font-semibold">Batch backtest snapshot</p>
                    <Badge tone={batchTaskStatus}>
                      {displayText(batchTaskStatusText, bestBacktestRow ? 'completed' : 'idle')}
                    </Badge>
                    <Badge tone="muted">{displayText(batchTaskResolvedKind, 'lab')}</Badge>
                  </div>
                  <div className="mt-3 grid gap-1 text-xs text-slate-300">
                    <p>task_id {displayText(batchTaskId, 'none')}</p>
                    <p>source {displayText(backtestMeta?.source, 'n/a')}</p>
                    <p>as_of {formatAsOf(backtestMeta?.as_of)}</p>
                    <p>stale {String(Boolean(backtestMeta?.stale))}</p>
                  </div>
                  {batchTaskRequestError ? <p className="mt-3 text-sm text-rose-300">{batchTaskRequestError}</p> : null}
                  {batchTaskErrorMessage ? <p className="mt-3 text-sm text-rose-300">{batchTaskErrorMessage}</p> : null}
                    {bestBacktestRow ? (
                      <div className="mt-4 space-y-2">
                      <p className="text-2xl font-semibold tracking-tight">{bestBacktestRow.symbol}</p>
                      <p className="text-sm text-slate-300">{bestBacktestRow.name}</p>
                      <div className="flex flex-wrap gap-2">
                        <Badge tone="positive" className="border-white/10 bg-white/10 text-white">{displayPercent(bestBacktestRow.total_return)}</Badge>
                        <Badge tone="warning" className="border-white/10 bg-white/10 text-white">Sharpe {displayFixed(bestBacktestRow.sharpe_ratio, 2)}</Badge>
                        <Badge tone="muted" className="border-white/10 bg-white/10 text-slate-200">{bestBacktestRow.trade_count} trades</Badge>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-300">
                      {batchTaskStatusText === 'queued'
                        ? 'The batch backtest task is queued. Keep the drawer open while the worker picks it up.'
                        : batchTaskStatusText === 'running'
                          ? 'The batch backtest task is running. This snapshot will fill automatically when the task completes.'
                          : batchTaskStatusText === 'failed'
                            ? 'The batch backtest task failed before returning rows. Check the task error and rerun.'
                            : 'Run the batch backtest to surface the strongest candidate here.'}
                    </p>
                  )}
                </div>

                <div className="grid gap-3">
                  {selectedRows.map((row) => (
                    <div key={row.symbol} className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">{row.symbol}</p>
                          <p className="text-sm text-slate-500">{displayText(row.name)}</p>
                        </div>
                        <Badge tone={row.score >= 60 ? 'positive' : row.score >= 40 ? 'warning' : 'muted'}>client quick rank {row.score}</Badge>
                      </div>
                      <p className="mt-3 text-sm text-slate-500">
                        PE {displayFixed(row.pe_ttm)} · ROE {displayFixed(row.roe)} · Growth {displayFixed(row.profit_yoy)}
                      </p>
                    </div>
                  ))}
                  {selectedRows.length === 0 ? <p className="text-sm text-slate-500">Select shortlist rows to build a batch action set.</p> : null}
                </div>
              </>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white/65 p-5 text-sm leading-7 text-slate-500">
                <p className="font-medium text-slate-900">Drawer is collapsed.</p>
                <p className="mt-2">Keep the shortlist central. Expand the drawer only when you need inspect, watchlist, or batch backtest actions.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone={selected.length > 0 ? 'default' : 'muted'}>{selected.length} selected</Badge>
                  <Badge tone={inspectRow ? 'warning' : 'muted'}>{inspectRow?.symbol ?? 'no inspect symbol'}</Badge>
                  <Badge tone={screenerMeta?.stale ? 'warning' : 'positive'}>{displayText(screenerMeta?.source, 'unknown')}</Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
