import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, Filter, RefreshCw, Search, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { analyzeSentiment } from '../api/analysis'
import { extractApiError } from '../api/client'
import { getNewsDetail, getNewsFeed, getNewsStats, getNewsTask, refreshNews } from '../api/news'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { ImportanceStars } from '../components/ui/importance-stars'
import { BACKGROUND_REFRESH_QUERY_OPTIONS, QUERY_REFRESH_MS } from '../lib/query-refresh'
import { cn } from '../lib/utils'
import { displayFixed, displayText } from '../utils/display'
import { displayPlainText, displayPreviewText } from '../utils/text'
import { daysAgo, formatAsOf, toDateInputLocal } from '../utils/time'

type MarketChoice = 'us' | 'cn' | 'crypto'
type NewsSentimentResult = {
  sentiment_score?: number
  sentiment_label?: string
  context_symbols?: string[]
  llm_analysis?: {
    summary?: string
    impact_assessment?: string
    key_factors?: string[]
    risk_factors?: string[]
  }
}

const MARKET_OPTIONS: MarketChoice[] = ['us', 'cn', 'crypto']
const CATEGORY_OPTIONS = ['earnings', 'macro', 'policy', 'geopolitical', 'social', 'other']

function toggleValue(values: string[], next: string) {
  return values.includes(next) ? values.filter((item) => item !== next) : [...values, next]
}

function toneTone(value?: number | null): 'positive' | 'negative' | 'muted' {
  if (typeof value !== 'number') return 'muted'
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'muted'
}

function InlineError({ message }: { message: string }) {
  return <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
}

export default function NewsCenterPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const queryParam = searchParams.get('query') ?? ''
  const [markets, setMarkets] = useState<MarketChoice[]>([...MARKET_OPTIONS])
  const [categories, setCategories] = useState<string[]>([])
  const [query, setQuery] = useState(queryParam)
  const [minImportance, setMinImportance] = useState(2)
  const [sentimentMin, setSentimentMin] = useState(-0.4)
  const [sentimentMax, setSentimentMax] = useState(0.6)
  const [startDate, setStartDate] = useState(daysAgo(7))
  const [endDate, setEndDate] = useState(toDateInputLocal(new Date()))
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [refreshTaskId, setRefreshTaskId] = useState<string | null>(null)
  const [lastHandledRefreshTaskId, setLastHandledRefreshTaskId] = useState<string | null>(null)
  const [sentimentById, setSentimentById] = useState<Record<number, NewsSentimentResult>>({})
  const [sentimentErrorById, setSentimentErrorById] = useState<Record<number, string>>({})
  const marketKey = useMemo(() => markets.slice().sort().join(',') || 'all', [markets])
  const categoryKey = useMemo(() => categories.slice().sort().join(',') || 'all', [categories])
  const selectionLeft = ((Math.min(sentimentMin, sentimentMax) + 1) / 2) * 100
  const selectionRight = ((Math.max(sentimentMin, sentimentMax) + 1) / 2) * 100

  useEffect(() => {
    if (queryParam === query) return
    setQuery(queryParam)
  }, [query, queryParam])

  useEffect(() => {
    const normalizedQuery = query.trim()
    if (normalizedQuery === queryParam) return
    const nextParams = new URLSearchParams(searchParams)
    if (normalizedQuery) {
      nextParams.set('query', normalizedQuery)
    } else {
      nextParams.delete('query')
    }
    setSearchParams(nextParams, { replace: true })
  }, [query, queryParam, searchParams, setSearchParams])

  const feedQuery = useInfiniteQuery({
    queryKey: ['news-center-feed', marketKey, categoryKey, minImportance, sentimentMin, sentimentMax, startDate, endDate, query],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      getNewsFeed({
        markets: markets.length === 0 || markets.length === MARKET_OPTIONS.length ? undefined : markets,
        query: query.trim() || undefined,
        category: categories.length ? categories : undefined,
        sentimentMin,
        sentimentMax,
        importance: minImportance,
        start: startDate,
        end: endDate,
        page: pageParam,
        page_size: 24,
      }),
    getNextPageParam: (lastPage) => {
      const page = Number(lastPage.meta?.page ?? 1)
      const pageSize = Number(lastPage.meta?.page_size ?? 24)
      const total = Number(lastPage.meta?.total ?? 0)
      return page * pageSize < total ? page + 1 : undefined
    },
    refetchInterval: QUERY_REFRESH_MS.newsFeed,
  })
  const detailQuery = useQuery({
    queryKey: ['news-center-detail', expandedId],
    queryFn: () => getNewsDetail(expandedId ?? -1),
    enabled: typeof expandedId === 'number' && expandedId > 0,
    refetchInterval: expandedId ? QUERY_REFRESH_MS.newsFeed : false,
  })

  const statsQuery = useQuery({
    queryKey: ['news-center-stats'],
    queryFn: getNewsStats,
    refetchInterval: QUERY_REFRESH_MS.newsStats,
  })
  const refreshMutation = useMutation({
    mutationFn: refreshNews,
    onSuccess: async (result) => {
      setRefreshTaskId(result.data?.task_id ?? null)
      setLastHandledRefreshTaskId(null)
    },
  })
  const refreshTaskQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['news-center-refresh-task', refreshTaskId],
    queryFn: () => getNewsTask(refreshTaskId ?? ''),
    enabled: Boolean(refreshTaskId),
    refetchInterval: (query) => {
      const status = String((query.state.data as { data?: { status?: string } } | undefined)?.data?.status ?? '').toLowerCase()
      return status && !['completed', 'failed'].includes(status) ? 2000 : false
    },
  })
  const sentimentMutation = useMutation({
    mutationFn: async (payload: { newsId: number; text: string; contextSymbols: string[] }) => {
      const result = await analyzeSentiment({
        text: payload.text,
        context_symbols: payload.contextSymbols,
      })
      return {
        newsId: payload.newsId,
        result: result.data as NewsSentimentResult | null,
      }
    },
    onSuccess: ({ newsId, result }) => {
      setSentimentById((current) => ({
        ...current,
        [newsId]: result ?? {},
      }))
      setSentimentErrorById((current) => {
        const next = { ...current }
        delete next[newsId]
        return next
      })
    },
    onError: (error, variables) => {
      setSentimentErrorById((current) => ({
        ...current,
        [variables.newsId]: extractApiError(error, 'failed to analyze sentiment'),
      }))
    },
  })

  const pages = feedQuery.data?.pages ?? []
  const items = pages.flatMap((page) => page.data ?? [])
  const latestMeta = pages[0]?.meta
  const detail = detailQuery.data?.data ?? null
  const stats = statsQuery.data?.data ?? {}
  const statsMeta = statsQuery.data?.meta
  const refreshPayload = refreshMutation.data?.data
  const refreshTaskStatus = refreshTaskQuery.data?.data?.status ?? refreshPayload?.status ?? null
  const refreshTaskStatusNormalized = String(refreshTaskStatus ?? '').toLowerCase()
  const isRefreshTaskActive = Boolean(refreshTaskId) && Boolean(refreshTaskStatusNormalized) && !['completed', 'failed'].includes(refreshTaskStatusNormalized)
  const feedError = feedQuery.error ? extractApiError(feedQuery.error, 'failed to load news feed') : null
  const statsError = statsQuery.error ? extractApiError(statsQuery.error, 'failed to load news stats') : null
  const refreshError = refreshMutation.error ? extractApiError(refreshMutation.error, 'failed to refresh news') : null
  const refreshTaskError = refreshTaskQuery.error ? extractApiError(refreshTaskQuery.error, 'failed to load refresh task') : null
  const statRows = useMemo(
    () => [
      { label: 'positive', value: stats.positive_count ?? 0, tone: 'positive' as const },
      { label: 'neutral', value: stats.neutral_count ?? 0, tone: 'muted' as const },
      { label: 'negative', value: stats.negative_count ?? 0, tone: 'negative' as const },
    ],
    [stats.negative_count, stats.neutral_count, stats.positive_count],
  )
  const dominantBucket = statRows.slice().sort((a, b) => b.value - a.value)[0]

  useEffect(() => {
    const taskData = refreshTaskQuery.data?.data
    if (!taskData?.task_id || !taskData.status) return
    if (lastHandledRefreshTaskId === taskData.task_id && ['completed', 'failed'].includes(String(taskData.status))) return
    if (taskData.status === 'completed') {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['news-center-feed'] }),
        queryClient.invalidateQueries({ queryKey: ['news-center-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['news-center-detail'] }),
      ])
      setLastHandledRefreshTaskId(taskData.task_id)
      return
    }
    if (taskData.status === 'failed') {
      setLastHandledRefreshTaskId(taskData.task_id)
    }
  }, [lastHandledRefreshTaskId, queryClient, refreshTaskQuery.data])

  return (
    <div data-page="news-center" className="grid gap-6 xl:grid-cols-[minmax(280px,0.86fr)_minmax(0,1.14fr)] 2xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.24fr)_minmax(300px,0.72fr)]">
      <Card data-layout-role="secondary" className="p-6">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-cyan-600" />
              Filters
            </CardTitle>
            <CardDescription>Use this rail to tighten the stream before reading details. The page should always feel stream-first, not control-first.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="grid gap-2 text-sm text-slate-500">
            Query
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                className="min-w-0 flex-1 border-0 bg-transparent text-slate-950 outline-none placeholder:text-slate-400"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="fed / earnings / tesla"
              />
            </div>
          </label>
          <div>
            <p className="text-sm text-slate-500">Markets</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant={markets.length === MARKET_OPTIONS.length ? 'primary' : 'chip'}
                size="sm"
                onClick={() => setMarkets([...MARKET_OPTIONS])}
              >
                all
              </Button>
              {MARKET_OPTIONS.map((item) => (
                <Button
                  key={item}
                  variant={markets.includes(item) ? 'primary' : 'chip'}
                  size="sm"
                  onClick={() => setMarkets((current) => toggleValue(current, item) as MarketChoice[])}
                >
                  {item}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm text-slate-500">Categories</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant={categories.length === 0 ? 'primary' : 'chip'} size="sm" onClick={() => setCategories([])}>
                all
              </Button>
              {CATEGORY_OPTIONS.map((item) => (
                <Button
                  key={item}
                  variant={categories.includes(item) ? 'primary' : 'chip'}
                  size="sm"
                  onClick={() => setCategories((current) => toggleValue(current, item))}
                >
                  {item}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-2 text-sm text-slate-500">
            <div className="flex items-center justify-between">
              <span>Sentiment Range</span>
              <span className="font-medium text-slate-700">
                {displayFixed(Math.min(sentimentMin, sentimentMax), 2)} ~ {displayFixed(Math.max(sentimentMin, sentimentMax), 2)}
              </span>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50/90 px-4 py-4">
              <div className="relative h-2 rounded-full bg-slate-200">
                <div
                  className="absolute h-full rounded-full bg-cyan-400"
                  style={{
                    left: `${Math.min(selectionLeft, selectionRight)}%`,
                    width: `${Math.max(4, Math.abs(selectionRight - selectionLeft))}%`,
                  }}
                />
              </div>
              <div className="mt-4 grid gap-3">
                <input
                  className="accent-cyan-500"
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={sentimentMin}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setSentimentMin(Math.min(next, sentimentMax))
                  }}
                />
                <input
                  className="accent-cyan-500"
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={sentimentMax}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setSentimentMax(Math.max(next, sentimentMin))
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-400">
                <span>-1.00</span>
                <span>0.00</span>
                <span>1.00</span>
              </div>
            </div>
          </div>
          <label className="grid gap-2 text-sm text-slate-500">
            <span className="flex items-center justify-between gap-3">
              <span>Min Importance ({minImportance})</span>
              <ImportanceStars value={minImportance} />
            </span>
            <input
              className="accent-cyan-500"
              type="range"
              min={1}
              max={5}
              step={1}
              value={minImportance}
              onChange={(event) => setMinImportance(Number(event.target.value))}
            />
          </label>
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm text-slate-500">
              Start
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm text-slate-500">
              End
              <input className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-950 outline-none" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
          </div>
        </CardContent>
      </Card>

      <Card data-layout-role="primary" className="p-6">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-600" />
              News Stream
            </CardTitle>
            <CardDescription>Judge the stream here. Filters and stats should support this column instead of competing with it.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="default">{feedQuery.isFetching ? 'loading' : `${items.length} items`}</Badge>
            <Button variant="chip" size="sm" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending || isRefreshTaskActive}>
              <RefreshCw className={cn('h-4 w-4', refreshMutation.isPending || isRefreshTaskActive ? 'animate-spin' : '')} />
              {refreshMutation.isPending || isRefreshTaskActive ? 'refreshing' : 'refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {feedError ? <InlineError message={feedError} /> : null}
          {refreshError ? <InlineError message={refreshError} /> : null}
          {refreshTaskError ? <InlineError message={refreshTaskError} /> : null}
          {refreshPayload?.task_id ? (
            <p className="rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-900">
              refresh {displayText(refreshTaskStatus, 'queued')} · task_id {displayText(refreshPayload.task_id, 'n/a')} · current stream may still be updating
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(markets.length === 0 || markets.length === MARKET_OPTIONS.length ? ['all'] : markets).map((item) => (
              <Badge key={item}>{item}</Badge>
            ))}
            {(categories.length ? categories : ['all categories']).map((item) => (
              <Badge key={item}>{item}</Badge>
            ))}
            <Badge>sentiment {displayFixed(Math.min(sentimentMin, sentimentMax), 2)}~{displayFixed(Math.max(sentimentMin, sentimentMax), 2)}</Badge>
            <Badge>importance {minImportance}</Badge>
            {query.trim() ? <Badge tone="warning">{query.trim()}</Badge> : null}
            <Badge tone={latestMeta?.stale ? 'warning' : 'positive'}>{displayText(latestMeta?.source, 'persisted')}</Badge>
            <Badge tone="muted">as_of {formatAsOf(latestMeta?.as_of)}</Badge>
            <Badge tone="muted">read_only {String(Boolean(latestMeta?.read_only))}</Badge>
          </div>
          {items.map((item) => {
            const expanded = expandedId === item.id
            const sentimentResult = sentimentById[item.id]
            const sentimentError = sentimentErrorById[item.id]
            const sentimentRunning = sentimentMutation.isPending && sentimentMutation.variables?.newsId === item.id
            return (
              <div
                key={item.id}
                className={cn(
                  'rounded-3xl border border-slate-200 border-l-4 bg-slate-50/90 p-4 transition hover:border-cyan-200 hover:bg-cyan-50/30',
                  item.sentiment && item.sentiment > 0
                    ? 'border-l-emerald-400'
                    : item.sentiment && item.sentiment < 0
                      ? 'border-l-rose-400'
                      : 'border-l-slate-300',
                )}
              >
                <button type="button" className="w-full text-left" onClick={() => setExpandedId(expanded ? null : item.id)}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneTone(item.sentiment)}>{displayFixed(item.sentiment, 2)}</Badge>
                      <span className="text-xs uppercase tracking-widest text-slate-400">
                        {displayText(item.source, 'source')} · {formatAsOf(item.published_at)}
                      </span>
                    </div>
                    <ImportanceStars value={item.importance} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone="warning">importance {displayText(item.importance, 'n/a')}</Badge>
                    <span className="text-xs uppercase tracking-widest text-slate-400">
                      {(item.categories ?? []).slice(0, 2).join(' · ') || 'uncategorized'}
                    </span>
                  </div>
                  <p className="mt-3 text-base font-semibold tracking-tight text-slate-950">{item.title}</p>
                  <p className="mt-2 text-safe-wrap text-sm leading-7 text-slate-500">
                    {displayPreviewText(item.llm_summary ?? item.llm_impact, 180, 'No summary yet.')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(item.symbols ?? []).slice(0, 4).map((symbol) => (
                      <Badge key={symbol} tone="muted">{symbol}</Badge>
                    ))}
                    {(item.markets ?? []).map((entry) => (
                      <Badge key={entry}>{entry}</Badge>
                    ))}
                  </div>
                </button>
                {expanded ? (
                  <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4 text-sm leading-7 text-slate-500">
                    {detailQuery.isFetching ? <p>Loading detail...</p> : null}
                    {detailQuery.error ? <InlineError message={extractApiError(detailQuery.error, 'failed to load news detail')} /> : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="chip"
                        size="sm"
                        disabled={sentimentRunning}
                        onClick={(event) => {
                          event.stopPropagation()
                          const analysisText = [
                            item.title,
                            detail?.content ?? detail?.llm_summary ?? item.llm_summary ?? item.llm_impact,
                          ]
                            .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                            .join('\n\n')
                          sentimentMutation.mutate({
                            newsId: item.id,
                            text: analysisText || item.title,
                            contextSymbols: item.symbols ?? [],
                          })
                        }}
                      >
                        {sentimentRunning ? 'Analyzing sentiment' : 'Analyze sentiment'}
                      </Button>
                      {sentimentResult?.sentiment_label ? (
                        <Badge tone={toneTone(sentimentResult.sentiment_score)}>
                          {sentimentResult.sentiment_label} {displayFixed(sentimentResult.sentiment_score, 3)}
                        </Badge>
                      ) : null}
                      {(sentimentResult?.context_symbols ?? []).map((symbol) => (
                        <Badge key={`context-${item.id}-${symbol}`} tone="muted">{symbol}</Badge>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400">
                      Card sentiment comes from the feed pipeline. On-demand sentiment below is recalculated from the expanded article context.
                    </p>
                    {sentimentError ? <InlineError message={sentimentError} /> : null}
                    {sentimentResult ? (
                      <div className="rounded-3xl border border-cyan-100 bg-cyan-50/60 p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-cyan-700">On-demand sentiment</p>
                        <p className="mt-2 text-safe-wrap text-sm leading-7 text-slate-600">
                          {displayPlainText(sentimentResult.llm_analysis?.summary, 'No sentiment summary available.')}
                        </p>
                        <p className="mt-2 text-safe-wrap text-sm leading-7 text-slate-600">
                          <span className="font-medium text-slate-900">Impact:</span>{' '}
                          {displayPlainText(sentimentResult.llm_analysis?.impact_assessment, 'No impact assessment available.')}
                        </p>
                        {(sentimentResult.llm_analysis?.key_factors?.length ?? 0) > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(sentimentResult.llm_analysis?.key_factors ?? []).map((factor) => (
                              <Badge key={`sentiment-factor-${item.id}-${factor}`} tone="muted">{factor}</Badge>
                            ))}
                          </div>
                        ) : null}
                        {(sentimentResult.llm_analysis?.risk_factors?.length ?? 0) > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(sentimentResult.llm_analysis?.risk_factors ?? []).map((factor) => (
                              <Badge key={`sentiment-risk-${item.id}-${factor}`} tone="warning">{factor}</Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="text-safe-wrap"><span className="font-medium text-slate-900">Summary:</span> {displayPlainText(detail?.llm_summary ?? item.llm_summary, 'No summary yet.')}</p>
                    <p className="text-safe-wrap"><span className="font-medium text-slate-900">Impact:</span> {displayPlainText(detail?.llm_impact ?? item.llm_impact, 'No impact note yet.')}</p>
                    {(detail?.llm_key_factors?.length ?? 0) > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {(detail?.llm_key_factors ?? []).map((factor) => (
                          <Badge key={`factor-${factor}`} tone="muted">{factor}</Badge>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-safe-wrap"><span className="font-medium text-slate-900">Content:</span> {displayPreviewText(displayPlainText(detail?.content), 420, 'No content available.')}</p>
                    <p><span className="font-medium text-slate-900">Categories:</span> {(detail?.categories ?? item.categories ?? []).join(', ') || '-'}</p>
                    {detail?.url ? (
                      <a
                        href={detail.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-700 underline-offset-2 hover:underline"
                      >
                        Open source link
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
          {items.length === 0 && !feedQuery.isFetching && !feedError ? <p className="text-sm text-slate-500">No data for current filter.</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              page {displayText(latestMeta?.page, 1)} · total {displayText(latestMeta?.total, items.length)}
            </p>
            <Button
              variant="chip"
              size="sm"
              onClick={() => feedQuery.fetchNextPage()}
              disabled={!feedQuery.hasNextPage || feedQuery.isFetchingNextPage}
            >
              {feedQuery.isFetchingNextPage ? 'loading more' : feedQuery.hasNextPage ? 'load more' : 'no more'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div data-layout-role="secondary" className="grid gap-6">
        <Card className="p-6">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-cyan-600" />
                Sentiment Stats
              </CardTitle>
              <CardDescription>Keep one compact statistical readout on the side while the center column owns the reading flow. This panel is a global 7d snapshot, not the current filter result.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {statsError ? <InlineError message={statsError} /> : null}
            <div className="panel-dark-solid rounded-3xl border border-slate-200 p-5">
              <p className="text-xs uppercase tracking-widest text-slate-300">dominant bucket</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight">{dominantBucket?.label ?? 'neutral'}</p>
              <p className="mt-2 text-sm text-slate-300">7d total {stats.total ?? 0}</p>
              <p className="mt-2 text-xs text-slate-400">snapshot {formatAsOf(statsMeta?.generated_at)}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Today</p>
                <p className="mt-2 text-xl font-semibold text-slate-950">{stats.today?.total ?? 0}</p>
                <p className="mt-2 text-sm text-slate-500">
                  + {stats.today?.positive_count ?? 0} / = {stats.today?.neutral_count ?? 0} / - {stats.today?.negative_count ?? 0}
                </p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Feed runtime</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{displayText(latestMeta?.source, 'persisted')}</p>
                <p className="mt-2 text-sm text-slate-500">stale {String(Boolean(latestMeta?.stale))}</p>
                <p className="mt-2 text-xs text-slate-400">feed as_of {formatAsOf(latestMeta?.as_of)}</p>
              </div>
            </div>
            <div className="grid gap-3">
              {statRows.map((row) => {
                const denominator = Math.max(stats.total ?? 0, 1)
                const width = `${Math.min(100, (row.value / denominator) * 100)}%`
                return (
                  <div key={row.label} className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-900">{row.label}</span>
                      <span className="text-slate-500">{row.value}</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={cn('h-full rounded-full', row.tone === 'positive' ? 'bg-emerald-400' : row.tone === 'negative' ? 'bg-rose-400' : 'bg-slate-400')}
                        style={{ width }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
