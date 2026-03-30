import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowRight, CalendarDays, Newspaper, Radar, ShieldCheck } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { getCnFlowHeatmap, getCorrelation, getSectorHeatmap, type CnFlowHeatmapRow, type SectorHeatmapRow } from '../api/analysis'
import { extractApiError } from '../api/client'
import { getEventCalendar } from '../api/events'
import { getBatchQuotes, getNorthbound, type BatchQuoteRow, type CnFlowRow } from '../api/market'
import { getNewsFeed } from '../api/news'
import { getDataStatus, getHealth } from '../api/system'
import { addWatchlistItem, getWatchlistQuotes, removeWatchlistItem, type WatchlistItem } from '../api/watchlist'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { ImportanceStars } from '../components/ui/importance-stars'
import { BACKGROUND_REFRESH_QUERY_OPTIONS, QUERY_REFRESH_MS } from '../lib/query-refresh'
import { cn } from '../lib/utils'
import { displayFixed, displayLocaleNumber, displayPercent, displayText } from '../utils/display'
import { displayPreviewText } from '../utils/text'
import { formatAsOf, toDateInputLocal } from '../utils/time'

type WatchlistQuote = WatchlistItem & {
  price?: number
  change_pct_24h?: number
  source?: string | null
  stale?: boolean | null
  as_of?: string | null
}

const INDEX_TRACKERS = [
  { label: 'SSE', symbol: '000001.SH' },
  { label: 'SZSE', symbol: '399001.SZ' },
  { label: 'NASDAQ', symbol: 'QQQ' },
  { label: 'S&P 500', symbol: 'SPY' },
  { label: 'BTC', symbol: 'BTC' },
]
const CRYPTO_HINTS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'ADA', 'AVAX', 'DOT']
const DASHBOARD_NEWS_FILTERS = [
  { value: 'all', label: 'all', market: 'all' as const },
  { value: 'us', label: 'us', market: 'us' as const },
  { value: 'cn', label: 'cn', market: 'cn' as const },
  { value: 'crypto', label: 'crypto', market: 'crypto' as const },
  { value: 'macro', label: 'macro', market: 'all' as const, category: 'macro' as const },
] as const

function toneTone(value?: number | null): 'positive' | 'negative' | 'muted' {
  if (typeof value !== 'number') return 'muted'
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'muted'
}

function runtimeTone(stale?: boolean | null, error?: string | null): 'positive' | 'warning' | 'negative' | 'muted' {
  if (error) return 'negative'
  if (typeof stale === 'boolean') return stale ? 'warning' : 'positive'
  return 'muted'
}

function InlineError({ message }: { message: string }) {
  return <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
}

export default function DashboardPage() {
  const today = toDateInputLocal(new Date())
  const queryClient = useQueryClient()
  const newsSentinelRef = useRef<HTMLDivElement | null>(null)
  const [watchlistSymbolInput, setWatchlistSymbolInput] = useState('')
  const [dashboardNewsMarket, setDashboardNewsMarket] = useState<(typeof DASHBOARD_NEWS_FILTERS)[number]['value']>('all')
  const activeNewsFilter = useMemo(
    () => DASHBOARD_NEWS_FILTERS.find((entry) => entry.value === dashboardNewsMarket) ?? DASHBOARD_NEWS_FILTERS[0],
    [dashboardNewsMarket],
  )

  const watchlistQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['dashboard-watchlist-summary'],
    queryFn: getWatchlistQuotes,
    refetchInterval: QUERY_REFRESH_MS.dashboardFast,
  })
  const addWatchlistMutation = useMutation({
    mutationFn: async (rawSymbol: string) => {
      const normalized = rawSymbol.trim().toUpperCase()
      const assetType = normalized.includes('-') || CRYPTO_HINTS.includes(normalized) ? 'crypto' : 'stock'
      return addWatchlistItem({
        symbol: normalized,
        asset_type: assetType,
      })
    },
    onSuccess: async () => {
      setWatchlistSymbolInput('')
      await queryClient.invalidateQueries({ queryKey: ['dashboard-watchlist-summary'] })
    },
  })
  const removeWatchlistMutation = useMutation({
    mutationFn: async (payload: { symbol: string; assetType: 'stock' | 'crypto' }) =>
      removeWatchlistItem(payload.symbol, payload.assetType),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard-watchlist-summary'] })
    },
  })
  const newsQuery = useInfiniteQuery({
    queryKey: ['dashboard-focus-news', dashboardNewsMarket],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      getNewsFeed({
        page_size: 6,
        page: pageParam,
        market: activeNewsFilter.market,
        category: activeNewsFilter.category,
      }),
    getNextPageParam: (lastPage) => {
      const page = Number(lastPage.meta?.page ?? 1)
      const pageSize = Number(lastPage.meta?.page_size ?? 6)
      const total = Number(lastPage.meta?.total ?? 0)
      return page * pageSize < total ? page + 1 : undefined
    },
    refetchInterval: QUERY_REFRESH_MS.dashboardNews,
  })
  const eventsQuery = useQuery({
    queryKey: ['dashboard-focus-events', today],
    queryFn: () =>
      getEventCalendar({
        start: today,
        end: today,
      }),
    refetchInterval: QUERY_REFRESH_MS.dashboardSlow,
  })
  const healthQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['dashboard-health-summary'],
    queryFn: getHealth,
    refetchInterval: QUERY_REFRESH_MS.dashboardFast,
  })
  const dataStatusQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['dashboard-data-status'],
    queryFn: getDataStatus,
    refetchInterval: QUERY_REFRESH_MS.dashboardFast,
  })
  const sectorHeatmapQuery = useQuery({
    queryKey: ['dashboard-sector-heatmap-summary'],
    queryFn: () => getSectorHeatmap('us'),
    refetchInterval: QUERY_REFRESH_MS.dashboardSlow,
  })
  const cnFlowHeatmapQuery = useQuery({
    queryKey: ['dashboard-cn-flow-heatmap'],
    queryFn: getCnFlowHeatmap,
    refetchInterval: QUERY_REFRESH_MS.dashboardSlow,
  })
  const correlationQuery = useQuery({
    queryKey: ['dashboard-cross-asset-correlation'],
    queryFn: () => getCorrelation({ symbols: ['SPY', 'QQQ', 'BTC'], period: '90d' }),
    refetchInterval: QUERY_REFRESH_MS.dashboardSlow,
  })
  const northboundQuery = useQuery({
    queryKey: ['dashboard-northbound-summary'],
    queryFn: () => getNorthbound({ market: 'all' }),
    refetchInterval: QUERY_REFRESH_MS.dashboardSlow,
  })
  const indexQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['dashboard-index-quotes'],
    queryFn: () => getBatchQuotes(INDEX_TRACKERS.map((item) => item.symbol)),
    refetchInterval: QUERY_REFRESH_MS.dashboardFast,
  })

  const watchlist = (watchlistQuery.data?.data ?? []) as WatchlistQuote[]
  const newsPages = newsQuery.data?.pages ?? []
  const newsItems = newsPages.flatMap((page) => page.data ?? [])
  const latestNewsMeta = newsPages[0]?.meta
  const eventItems = eventsQuery.data?.data ?? []
  const indexMap = new Map((indexQuery.data?.data ?? []).map((row: BatchQuoteRow) => [row.symbol, row]))
  const sectorRows = (sectorHeatmapQuery.data?.data ?? []) as SectorHeatmapRow[]
  const providerChecks = dataStatusQuery.data?.data?.provider_health?.checks ?? []
  const providerAggregate = dataStatusQuery.data?.data?.provider_health?.summary
  const stockRuntimeSample = dataStatusQuery.data?.data?.stock_quote_aapl
  const cryptoRuntimeSample = dataStatusQuery.data?.data?.crypto_quote_btc
  const datasetStatus = dataStatusQuery.data?.data?.datasets
  const cnFlowRows = (cnFlowHeatmapQuery.data?.data ?? []) as CnFlowHeatmapRow[]
  const correlationRows = correlationQuery.data?.data?.matrix ?? []
  const llmStatus = dataStatusQuery.data?.data?.llm
  const watchlistError = watchlistQuery.error ? extractApiError(watchlistQuery.error, 'failed to load watchlist quotes') : null
  const watchlistActionError =
    (addWatchlistMutation.error && extractApiError(addWatchlistMutation.error, 'failed to add watchlist item')) ||
    (removeWatchlistMutation.error && extractApiError(removeWatchlistMutation.error, 'failed to remove watchlist item')) ||
    null
  const newsError = newsQuery.error ? extractApiError(newsQuery.error, 'failed to load focus news') : null
  const eventsError = eventsQuery.error ? extractApiError(eventsQuery.error, 'failed to load events calendar') : null
  const healthError = healthQuery.error ? extractApiError(healthQuery.error, 'failed to load system health') : null
  const dataStatusError = dataStatusQuery.error ? extractApiError(dataStatusQuery.error, 'failed to load runtime status') : null
  const sectorError = sectorHeatmapQuery.error ? extractApiError(sectorHeatmapQuery.error, 'failed to load breadth snapshot') : null
  const cnFlowError = cnFlowHeatmapQuery.error ? extractApiError(cnFlowHeatmapQuery.error, 'failed to load cn flow heatmap') : null
  const correlationError = correlationQuery.error ? extractApiError(correlationQuery.error, 'failed to load cross-asset correlation') : null
  const northboundError = northboundQuery.error ? extractApiError(northboundQuery.error, 'failed to load northbound flow') : null
  const indexError = indexQuery.error ? extractApiError(indexQuery.error, 'failed to load index quotes') : null
  const sectorMeta = sectorHeatmapQuery.data?.meta
  const cnFlowMeta = cnFlowHeatmapQuery.data?.meta
  const northboundMeta = northboundQuery.data?.meta
  const runtimeHealthError = healthError || dataStatusError

  const topHeatRow =
    sectorRows.length > 0
      ? [...sectorRows].sort((left, right) => Math.abs(right.heat_score) - Math.abs(left.heat_score))[0]
      : null

  const northboundSummary = (() => {
    const rows = (northboundQuery.data?.data ?? []) as CnFlowRow[]
    if (rows.length === 0) {
      return {
        latestDate: null as string | null,
        total: null as number | null,
      }
    }
    const latestDate = rows.reduce((maxDate, row) => (row.trade_date > maxDate ? row.trade_date : maxDate), rows[0].trade_date)
    const total = rows
      .filter((row) => row.trade_date === latestDate)
      .reduce((accumulator, item) => accumulator + (Number(item.net_buy) || 0), 0)
    return { latestDate, total }
  })()
  const cnFlowLeaders = useMemo(
    () =>
      [...cnFlowRows]
        .sort((left, right) => Math.abs(Number(right.main_net ?? 0)) - Math.abs(Number(left.main_net ?? 0)))
        .slice(0, 4),
    [cnFlowRows],
  )
  const correlationCards = useMemo(
    () =>
      correlationRows.map((row) => ({
        symbol: row.symbol,
        strongestPeer: Object.entries(row.correlations ?? {})
          .filter(([peer]) => peer !== row.symbol)
          .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))[0] ?? null,
      })),
    [correlationRows],
  )
  const handleAddWatchlist = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = watchlistSymbolInput.trim().toUpperCase()
    if (!normalized) return
    addWatchlistMutation.mutate(normalized)
  }

  useEffect(() => {
    const target = newsSentinelRef.current
    if (!target || typeof IntersectionObserver === 'undefined') return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && newsQuery.hasNextPage && !newsQuery.isFetchingNextPage) {
          void newsQuery.fetchNextPage()
        }
      },
      { rootMargin: '240px 0px' },
    )
    observer.observe(target)
    return () => {
      observer.disconnect()
    }
  }, [dashboardNewsMarket, newsQuery.fetchNextPage, newsQuery.hasNextPage, newsQuery.isFetchingNextPage])

  return (
    <div data-page="dashboard" className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
      <Card data-layout-role="primary" className="p-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-cyan-600" />
                Market Pulse
              </CardTitle>
              <CardDescription>Use the dashboard to scan the tape and jump into the page that owns the next decision.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="secondary">
                <Link to="/market/AAPL">
                  Open Market
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="chip">
                <Link to="/screener">Open Screener</Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {indexError ? <InlineError message={indexError} /> : null}
          <div className="grid gap-3 md:grid-cols-5">
            {INDEX_TRACKERS.map((tracker) => {
              const quote = indexMap.get(tracker.symbol)
              return (
                <div key={tracker.symbol} className="rounded-3xl border border-slate-200 bg-slate-50/90 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{tracker.label}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{tracker.symbol}</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{displayFixed(quote?.price)}</p>
                  <p
                    className={cn(
                      'mt-1 text-xs',
                      quote?.change_pct_24h && quote.change_pct_24h > 0
                        ? 'text-emerald-600'
                        : quote?.change_pct_24h && quote.change_pct_24h < 0
                          ? 'text-rose-600'
                          : 'text-slate-500',
                    )}
                  >
                    {displayPercent(quote?.change_pct_24h)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={runtimeTone(quote?.stale, quote?.error)}>{displayText(quote?.source, quote?.error ? 'error' : 'source n/a')}</Badge>
                    <Badge tone="muted">{formatAsOf(quote?.as_of)}</Badge>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)]">
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Watchlist Glance</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">Tracked names ready to open.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="muted">{watchlist.length} names</Badge>
                  <Badge tone="muted">{formatAsOf(watchlistQuery.data?.meta?.as_of)}</Badge>
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                {watchlistError ? <InlineError message={watchlistError} /> : null}
                {watchlistActionError ? <InlineError message={watchlistActionError} /> : null}
                <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleAddWatchlist}>
                  <input
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-950 outline-none"
                    value={watchlistSymbolInput}
                    onChange={(event) => setWatchlistSymbolInput(event.target.value)}
                    placeholder="Add symbol (AAPL / 600000.SH / BTC)"
                  />
                  <Button type="submit" size="sm" disabled={!watchlistSymbolInput.trim() || addWatchlistMutation.isPending}>
                    {addWatchlistMutation.isPending ? 'Adding' : 'Add'}
                  </Button>
                </form>
                {watchlist.slice(0, 4).map((item) => (
                  <div key={`${item.symbol}-${item.asset_type}`} className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <Link to={`/market/${item.symbol}`} className="min-w-0 flex-1 transition hover:text-cyan-700">
                        <p className="font-semibold text-slate-950">{item.symbol}</p>
                        <p className="text-xs text-slate-500">{displayText(item.name, item.asset_type)}</p>
                      </Link>
                      <Button
                        variant="chip"
                        size="sm"
                        disabled={removeWatchlistMutation.isPending}
                        onClick={() => removeWatchlistMutation.mutate({ symbol: item.symbol, assetType: item.asset_type })}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{displayFixed(item.price)}</p>
                        <Badge tone={toneTone(item.change_pct_24h)}>{displayPercent(item.change_pct_24h)}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge tone={runtimeTone(item.stale, item.error)}>{displayText(item.source, item.error ? 'error' : 'source n/a')}</Badge>
                        <Badge tone="muted">{formatAsOf(item.as_of)}</Badge>
                      </div>
                    </div>
                  </div>
                ))}
                {watchlist.length === 0 && !watchlistError ? <p className="text-sm text-slate-500">No watchlist items yet.</p> : null}
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-400">News Stream</p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">Keep the homepage decision flow centered on the signal stream.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {DASHBOARD_NEWS_FILTERS.map((entry) => (
                      <Button
                        key={entry.value}
                        size="sm"
                        variant={dashboardNewsMarket === entry.value ? 'primary' : 'chip'}
                        onClick={() => setDashboardNewsMarket(entry.value)}
                      >
                        {entry.label}
                      </Button>
                    ))}
                  </div>
                </div>
                {newsError ? <div className="mt-4"><InlineError message={newsError} /></div> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone={runtimeTone(latestNewsMeta?.stale, newsError)}>{displayText(latestNewsMeta?.source, 'persisted')}</Badge>
                  <Badge tone="muted">as_of {formatAsOf(latestNewsMeta?.as_of)}</Badge>
                  <Badge tone="muted">read_only {String(Boolean(latestNewsMeta?.read_only))}</Badge>
                </div>
                <div className="mt-4 grid gap-3">
                  {newsItems.map((item) => (
                    <Link
                      key={`dashboard-news-${item.id}`}
                      to={`/news?query=${encodeURIComponent(item.symbols?.[0] ?? item.title)}`}
                      className={cn(
                        'rounded-2xl border border-slate-200 border-l-4 bg-white px-4 py-4 transition hover:border-cyan-200',
                        item.sentiment && item.sentiment > 0
                          ? 'border-l-emerald-400'
                          : item.sentiment && item.sentiment < 0
                            ? 'border-l-rose-400'
                            : 'border-l-slate-300',
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="text-xs uppercase tracking-widest text-slate-400">{displayText(item.source, 'source')} · {formatAsOf(item.published_at)}</p>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <ImportanceStars value={item.importance} />
                          <Badge tone={toneTone(item.sentiment)}>{displayFixed(item.sentiment, 2)}</Badge>
                        </div>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-950">{item.title}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {displayPreviewText(item.llm_summary ?? item.llm_impact, 160, 'No summary yet.')}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(item.categories ?? []).slice(0, 2).map((entry) => (
                          <Badge key={`${item.id}-category-${entry}`} tone="warning">{entry}</Badge>
                        ))}
                        {(item.markets ?? []).slice(0, 3).map((entry) => (
                          <Badge key={`${item.id}-${entry}`} tone="muted">{entry}</Badge>
                        ))}
                        {(item.symbols ?? []).slice(0, 3).map((entry) => (
                          <Badge key={`${item.id}-${entry}`}>{entry}</Badge>
                        ))}
                      </div>
                    </Link>
                  ))}
                  {newsItems.length === 0 && !newsError ? <p className="text-sm text-slate-500">No focus news available.</p> : null}
                </div>
                <div ref={newsSentinelRef} className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-500">
                  {newsQuery.hasNextPage
                    ? newsQuery.isFetchingNextPage
                      ? 'Loading the next news page automatically...'
                      : 'Scroll into this zone to auto-load the next news page.'
                    : 'News stream is fully loaded.'}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    variant="chip"
                    size="sm"
                    onClick={() => newsQuery.fetchNextPage()}
                    disabled={!newsQuery.hasNextPage || newsQuery.isFetchingNextPage}
                  >
                    {newsQuery.isFetchingNextPage ? 'loading more' : newsQuery.hasNextPage ? 'load more' : 'stream end'}
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Breadth Snapshot</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{displayText(topHeatRow?.sector, 'pending')}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={runtimeTone(sectorMeta?.stale, sectorError)}>{sectorError ? 'error' : displayText(sectorMeta?.source, 'source n/a')}</Badge>
                    <Badge tone={sectorMeta?.stale ? 'warning' : 'muted'}>stale {String(Boolean(sectorMeta?.stale))}</Badge>
                    <Badge tone="muted">{formatAsOf(sectorMeta?.as_of)}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    heat {displayFixed(topHeatRow?.heat_score, 3)} · avg {displayPercent(topHeatRow?.avg_change_pct)}
                  </p>
                  {sectorError ? <div className="mt-3"><InlineError message={sectorError} /></div> : null}
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Northbound Flow</p>
                  <p
                    className={cn(
                      'mt-2 text-lg font-semibold',
                      (northboundSummary.total ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600',
                    )}
                  >
                    {displayLocaleNumber(northboundSummary.total)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={runtimeTone(northboundMeta?.stale, northboundError)}>
                      {northboundError ? 'error' : displayText(northboundMeta?.source, 'source unavailable')}
                    </Badge>
                    <Badge tone={northboundMeta?.stale ? 'warning' : 'muted'}>stale {displayText(northboundMeta?.stale, 'unknown')}</Badge>
                    <Badge tone="muted">{formatAsOf(northboundMeta?.as_of)}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {displayText(northboundSummary.latestDate, 'no date')} · {displayText(northboundQuery.data?.meta?.count, '0')} rows
                  </p>
                  {northboundError ? <div className="mt-3"><InlineError message={northboundError} /></div> : null}
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Cross-Asset Correlation</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={correlationError ? 'negative' : 'muted'}>{correlationError ? 'error' : 'derived snapshot'}</Badge>
                    <Badge tone="muted">period 90d</Badge>
                    <Badge tone="muted">rows {displayText(correlationQuery.data?.meta?.rows, 0)}</Badge>
                  </div>
                  {correlationError ? <div className="mt-3"><InlineError message={correlationError} /></div> : null}
                  <div className="mt-4 grid gap-3">
                    {correlationCards.map((item) => (
                      <div key={`corr-${item.symbol}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <p className="font-semibold text-slate-950">{item.symbol}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          strongest {item.strongestPeer?.[0] ?? 'n/a'} · {displayFixed(item.strongestPeer?.[1], 3)}
                        </p>
                      </div>
                    ))}
                    {correlationCards.length === 0 && !correlationError ? <p className="text-sm text-slate-500">No correlation matrix available.</p> : null}
                  </div>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">CN Flow Leaders</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge tone={cnFlowError ? 'negative' : runtimeTone(cnFlowMeta?.stale, null)}>
                      {cnFlowError ? 'error' : displayText(cnFlowMeta?.source, 'snapshot')}
                    </Badge>
                    <Badge tone={cnFlowMeta?.stale ? 'warning' : 'muted'}>stale {displayText(cnFlowMeta?.stale, 'unknown')}</Badge>
                    <Badge tone="muted">{formatAsOf(cnFlowMeta?.as_of ?? cnFlowMeta?.generated_at)}</Badge>
                  </div>
                  {cnFlowError ? <div className="mt-3"><InlineError message={cnFlowError} /></div> : null}
                  <div className="mt-4 grid gap-3">
                    {cnFlowLeaders.map((item) => (
                      <div key={`cn-flow-${item.symbol}-${item.trade_date}`} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-950">{displayText(item.display_name ?? item.symbol, 'n/a')}</p>
                            <p className="mt-1 text-sm text-slate-500">
                              {displayText(item.leader_symbol, item.entity_type === 'sector' ? 'leader unavailable' : 'symbol')}
                              {' · '}
                              {displayPercent(item.change_pct)}
                            </p>
                          </div>
                          <Badge tone={(item.main_net ?? 0) >= 0 ? 'positive' : 'negative'}>{displayLocaleNumber(item.main_net)}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{displayText(item.trade_date, 'n/a')}</p>
                      </div>
                    ))}
                    {cnFlowLeaders.length === 0 && !cnFlowError ? <p className="text-sm text-slate-500">No CN flow leaders available.</p> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6">
        <Card data-layout-role="secondary" className="p-6">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-cyan-600" />
                  Event Queue
                </CardTitle>
                <CardDescription>首页把新闻流放回主画布，这里只保留今天的事件队列和跳转动作。</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="chip">
                  <Link to="/events">Open Events</Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link to="/news">Open News</Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="flex flex-wrap gap-2">
              <Badge tone="muted">news {newsItems.length}</Badge>
              <Badge tone="muted">events {eventItems.length}</Badge>
              <Badge tone="muted">events as_of {formatAsOf(eventsQuery.data?.meta?.as_of)}</Badge>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Today Events Queue</p>
              {eventsError ? <div className="mt-3"><InlineError message={eventsError} /></div> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={runtimeTone(eventsQuery.data?.meta?.stale, eventsError)}>{displayText(eventsQuery.data?.meta?.source, 'persisted')}</Badge>
                <Badge tone="muted">as_of {formatAsOf(eventsQuery.data?.meta?.as_of)}</Badge>
                <Badge tone="muted">read_only {String(Boolean(eventsQuery.data?.meta?.read_only))}</Badge>
              </div>
              <div className="mt-3 grid gap-3">
                {eventItems.slice(0, 5).map((item) => (
                  <Link
                    key={`dashboard-event-${item.id}`}
                    to="/events"
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:border-cyan-200"
                  >
                    <p className="text-xs uppercase tracking-widest text-slate-400">
                      {item.event_type} · {item.event_date}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">{item.title}</p>
                    <p className="mt-2 text-sm text-slate-500">{displayPreviewText((item.symbols ?? []).join(', '), 96, 'broad market')}</p>
                  </Link>
                ))}
                {eventItems.length === 0 && !eventsError ? <p className="text-sm text-slate-500">No scheduled events today.</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card data-layout-role="secondary" className="p-6">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-cyan-600" />
                Runtime Health
              </CardTitle>
              <CardDescription>Keep one compact view of health, providers, freshness, and LLM runtime configuration.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {runtimeHealthError ? <InlineError message={runtimeHealthError} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">System</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{displayText(healthQuery.data?.status, 'loading')}</p>
                <p className="mt-2 text-sm text-slate-500">version {displayText(healthQuery.data?.version, 'n/a')}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Freshness</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{formatAsOf(dataStatusQuery.data?.meta?.generated_at)}</p>
                <p className="mt-2 text-sm text-slate-500">
                  provider {displayText(providerAggregate?.status, 'loading')} · cache {String(Boolean(dataStatusQuery.data?.meta?.served_from_cache))}
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/80 p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Provider Checks</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {providerChecks.slice(0, 4).map((item) => (
                  <Badge key={item.name} tone={item.status === 'ok' ? 'positive' : item.status === 'degraded' ? 'warning' : 'negative'}>
                    {displayText(item.name, 'provider')} · {displayText(item.status, 'unknown')}
                  </Badge>
                ))}
                {providerChecks.length === 0 ? <Badge tone="muted">loading</Badge> : null}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {[
                { key: 'stock-runtime-sample', sample: stockRuntimeSample },
                { key: 'crypto-runtime-sample', sample: cryptoRuntimeSample },
              ].map(({ key, sample }) => (
                <div key={key} className="rounded-3xl border border-slate-200 bg-white/80 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Live Sample</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">
                        {displayText(sample?.symbol, 'symbol')} · {displayText(sample?.asset_type, 'asset')}
                      </p>
                    </div>
                    <Badge tone={runtimeTone(sample?.stale, sample?.error)}>{displayText(sample?.status, 'loading')}</Badge>
                  </div>
                  <p className="mt-4 text-2xl font-semibold text-slate-950">{displayFixed(sample?.price)}</p>
                  <p className={cn('mt-1 text-sm', toneTone(sample?.change_pct_24h) === 'positive' ? 'text-emerald-600' : toneTone(sample?.change_pct_24h) === 'negative' ? 'text-rose-600' : 'text-slate-500')}>
                    {displayPercent(sample?.change_pct_24h)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge tone={runtimeTone(sample?.stale, sample?.error)}>{displayText(sample?.source, sample?.error ? 'error' : 'source n/a')}</Badge>
                    <Badge tone="muted">{displayText(sample?.provider, 'provider n/a')}</Badge>
                    <Badge tone="muted">{formatAsOf(sample?.as_of)}</Badge>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/80 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Dataset Coverage</p>
                  <p className="mt-2 text-sm text-slate-500">Runtime summary of news, event, and watchlist coverage from the live backend state.</p>
                </div>
                <Badge tone={datasetStatus?.status === 'ok' ? 'positive' : 'warning'}>{displayText(datasetStatus?.status, 'loading')}</Badge>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">News</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{displayLocaleNumber(datasetStatus?.news_items_last_24h)} / {displayLocaleNumber(datasetStatus?.news_items_total)}</p>
                  <p className="mt-2 text-sm text-slate-500">24h / total</p>
                  <p className="mt-2 text-xs text-slate-500">latest {formatAsOf(datasetStatus?.latest_news_at)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Events</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{displayLocaleNumber(datasetStatus?.upcoming_events_30d)} / {displayLocaleNumber(datasetStatus?.market_events_total)}</p>
                  <p className="mt-2 text-sm text-slate-500">upcoming 30d / total</p>
                  <p className="mt-2 text-xs text-slate-500">latest {formatAsOf(datasetStatus?.latest_event_at)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Watchlist</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{displayLocaleNumber(datasetStatus?.watchlist_items_total)}</p>
                  <p className="mt-2 text-sm text-slate-500">tracked runtime items</p>
                  <p className="mt-2 text-xs text-slate-500">ttl {displayLocaleNumber(dataStatusQuery.data?.meta?.cache_ttl_sec)} sec</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/80 p-5">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">LLM Runtime</p>
              <p className="mt-2 text-sm text-slate-500">
                {llmStatus?.configured ? `configured · ${displayText(llmStatus.model, 'model')} · ${displayText(llmStatus.api_style, 'api')}` : 'not configured'}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                endpoint {displayText(llmStatus?.base_url, 'n/a')} {displayText(llmStatus?.endpoint_path, '')}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
