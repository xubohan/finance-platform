import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowRight, BookText, CandlestickChart, Landmark, Newspaper, ShieldPlus, Sigma, Waves } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { extractApiError } from '../api/client'
import { getEventHistory } from '../api/events'
import IndicatorPanel from '../components/chart/IndicatorPanel'
import KlineChart, { type KlineMarker, type OscillatorMode } from '../components/chart/KlineChart'
import {
  getBigOrderFlow,
  getDragonTiger,
  getFinancials,
  getKline,
  getMargin,
  getMarketSummary,
  getNorthbound,
  syncHistory,
  type CnFlowRow,
  type DragonTigerRow,
  type FinancialRow,
  type MarketDetailPeriod,
  toCandles,
} from '../api/market'
import { getNewsFeed } from '../api/news'
import { addWatchlistItem } from '../api/watchlist'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { ImportanceStars } from '../components/ui/importance-stars'
import { BACKGROUND_REFRESH_QUERY_OPTIONS, getMarketChartRefreshMs, getMarketQuoteRefreshMs, QUERY_REFRESH_MS } from '../lib/query-refresh'
import { cn } from '../lib/utils'
import { displayFixed, displayLocaleNumber, displayPercent, displayText } from '../utils/display'
import { displayPreviewText } from '../utils/text'
import { daysAgo, formatAsOf, toDateInputLocal, yearsAgo } from '../utils/time'

type DetailTab = 'news' | 'financials' | 'flow' | 'dragon'
type FinancialReportType = 'income' | 'balance' | 'cashflow'
type FinancialPeriod = 'annual' | 'quarterly'

const PERIOD_OPTIONS: Array<{ value: MarketDetailPeriod; label: string }> = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '1h', label: '1h' },
  { value: '1d', label: '1d' },
  { value: '1W', label: '1w' },
  { value: '1M', label: '1M' },
]

const OSCILLATOR_OPTIONS: OscillatorMode[] = ['none', 'MACD', 'KDJ', 'RSI']

function InlineError({ message }: { message: string }) {
  return <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{message}</p>
}

function toneTone(value?: number | null): 'positive' | 'negative' | 'muted' {
  if (typeof value !== 'number') return 'muted'
  if (value > 0) return 'positive'
  if (value < 0) return 'negative'
  return 'muted'
}

function inferSymbolType(symbol: string, assetType?: string | null) {
  if (assetType === 'crypto') return 'crypto'
  if (assetType === 'stock') return 'stock'
  return symbol.includes('.') ? 'stock' : symbol === 'BTC' || symbol === 'ETH' ? 'crypto' : 'stock'
}

function buildFinancialSnapshot(frame: FinancialRow[]) {
  const first = frame[0]
  if (!first) return []
  return Object.entries(first)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 8)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function pickMetric(quote: Record<string, unknown> | null, rows: FinancialRow[], keys: string[]): number | null {
  for (const key of keys) {
    const fromQuote = toNumber(quote?.[key])
    if (fromQuote !== null) return fromQuote
  }
  for (const row of rows) {
    for (const key of keys) {
      const value = toNumber(row[key])
      if (value !== null) return value
    }
  }
  return null
}

function buildNewsMarkers(items: Array<{ published_at: string; title: string; sentiment: number | null }>): KlineMarker[] {
  return items.slice(0, 8).map((item) => ({
    time: item.published_at.includes('T') ? (Math.floor(Date.parse(item.published_at) / 1000) as KlineMarker['time']) : item.published_at.slice(0, 10),
    text: item.title.slice(0, 14),
    color: item.sentiment && item.sentiment < 0 ? '#f97316' : '#06b6d4',
    shape: item.sentiment && item.sentiment < 0 ? 'arrowDown' : 'arrowUp',
    position: item.sentiment && item.sentiment < 0 ? 'aboveBar' : 'belowBar',
  }))
}

function buildEventMarkers(items: Array<{ event_date: string; title: string; event_type?: string }>): KlineMarker[] {
  return items.slice(0, 8).map((item) => ({
    time: item.event_date,
    text: item.title.slice(0, 14),
    color: item.event_type === 'policy' ? '#f97316' : item.event_type === 'earnings' ? '#10b981' : '#0ea5e9',
    shape: 'circle',
    position: 'inBar',
  }))
}

function fallbackSentimentDistribution(items: Array<{ sentiment: number | null }>) {
  return items.reduce(
    (accumulator, item) => {
      const value = item.sentiment ?? 0
      if (value > 0.15) {
        accumulator.positive += 1
      } else if (value < -0.15) {
        accumulator.negative += 1
      } else {
        accumulator.neutral += 1
      }
      return accumulator
    },
    { positive: 0, neutral: 0, negative: 0 },
  )
}

export default function MarketDetailPage() {
  const queryClient = useQueryClient()
  const params = useParams()
  const symbol = useMemo(() => (params.symbol ?? 'AAPL').toUpperCase(), [params.symbol])
  const isAShare = symbol.endsWith('.SH') || symbol.endsWith('.SZ') || symbol.endsWith('.BJ')
  const symbolAssetType = useMemo<'stock' | 'crypto'>(() => inferSymbolType(symbol), [symbol])
  const newsWindowStart = useMemo(() => daysAgo(30), [])
  const newsWindowEnd = useMemo(() => toDateInputLocal(new Date()), [])
  const [period, setPeriod] = useState<MarketDetailPeriod>('1d')
  const [activeTab, setActiveTab] = useState<DetailTab>('news')
  const [financialReportType, setFinancialReportType] = useState<FinancialReportType>('income')
  const [financialPeriod, setFinancialPeriod] = useState<FinancialPeriod>('annual')
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>(['MA', 'EMA', 'BOLL'])
  const [oscillator, setOscillator] = useState<OscillatorMode>('MACD')
  const northboundMarket = useMemo<'sh' | 'sz' | 'all'>(() => {
    if (symbol.endsWith('.SH')) return 'sh'
    if (symbol.endsWith('.SZ')) return 'sz'
    return 'all'
  }, [symbol])

  const summaryQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['market-summary', symbol],
    queryFn: () => getMarketSummary(symbol),
    refetchInterval: getMarketQuoteRefreshMs(symbolAssetType),
  })
  const klineQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['market-kline', symbol, period],
    queryFn: () => getKline(symbol, period),
    refetchInterval: getMarketChartRefreshMs(symbolAssetType),
  })
  const newsQuery = useQuery({
    queryKey: ['market-news', symbol, newsWindowStart, newsWindowEnd],
    queryFn: () =>
      getNewsFeed({
        symbols: symbol,
        page_size: 30,
        start: newsWindowStart,
        end: newsWindowEnd,
      }),
    refetchInterval: QUERY_REFRESH_MS.marketContext,
  })
  const eventsQuery = useQuery({
    queryKey: ['market-events', symbol],
    queryFn: () => getEventHistory({ symbol, limit: 10 }),
    enabled: inferSymbolType(symbol) === 'stock',
    refetchInterval: QUERY_REFRESH_MS.marketSlow,
  })
  const financialsQuery = useQuery({
    queryKey: ['market-financials', symbol, financialReportType, financialPeriod],
    queryFn: () => getFinancials(symbol, { report_type: financialReportType, period: financialPeriod, limit: 6 }),
    enabled: inferSymbolType(symbol) === 'stock',
    refetchInterval: 5 * 60_000,
  })
  const marginQuery = useQuery({
    queryKey: ['market-margin', symbol],
    queryFn: () => getMargin(symbol),
    enabled: isAShare,
    refetchInterval: QUERY_REFRESH_MS.marketSlow,
  })
  const bigOrderQuery = useQuery({
    queryKey: ['market-big-order', symbol],
    queryFn: () => getBigOrderFlow(symbol),
    enabled: isAShare,
    refetchInterval: QUERY_REFRESH_MS.marketSlow,
  })
  const dragonQuery = useQuery({
    queryKey: ['market-dragon', symbol],
    queryFn: () => getDragonTiger(symbol),
    enabled: isAShare,
    refetchInterval: QUERY_REFRESH_MS.marketSlow,
  })
  const northboundQuery = useQuery({
    queryKey: ['market-northbound', northboundMarket],
    queryFn: () => getNorthbound({ market: northboundMarket }),
    enabled: isAShare,
    refetchInterval: QUERY_REFRESH_MS.marketSlow,
  })

  const addWatchlistMutation = useMutation({
    mutationFn: () =>
      addWatchlistItem({
        symbol,
        asset_type: inferSymbolType(symbol, summaryQuery.data?.data?.quote?.asset_type),
      }),
  })
  const syncHistoryMutation = useMutation({
    mutationFn: () =>
      syncHistory(symbol, yearsAgo(3), toDateInputLocal(new Date())),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['market-summary', symbol] }),
        queryClient.invalidateQueries({ queryKey: ['market-kline', symbol] }),
      ])
    },
  })

  const quote = summaryQuery.data?.data?.quote ?? null
  const historyStatus = summaryQuery.data?.data?.history_status ?? null
  const quoteMeta = summaryQuery.data?.meta?.quote
  const klineMeta = klineQuery.data?.meta
  const newsMeta = newsQuery.data?.meta
  const candles = toCandles(klineQuery.data?.data ?? [])
  const news = newsQuery.data?.data ?? []
  const visibleNews = useMemo(() => news.slice(0, 10), [news])
  const signalNotes = useMemo(() => news.slice(0, 3), [news])
  const events = eventsQuery.data?.data ?? []
  const financials = financialsQuery.data?.data ?? []
  const marginRows = marginQuery.data?.data ?? []
  const bigOrderRows = bigOrderQuery.data?.data ?? []
  const dragonRows = dragonQuery.data?.data ?? []
  const northboundRows = northboundQuery.data?.data ?? []
  const chartMarkers = useMemo(() => [...buildEventMarkers(events), ...buildNewsMarkers(news)], [events, news])
  const fundamentals = useMemo(() => buildFinancialSnapshot(financials), [financials])
  const fixedFundamentals = useMemo(
    () => [
      { label: 'PE', value: pickMetric(quote as Record<string, unknown> | null, financials, ['pe_ttm', 'pe', 'pe_ratio']) },
      { label: 'PB', value: pickMetric(quote as Record<string, unknown> | null, financials, ['pb', 'pb_ratio', 'price_to_book']) },
      { label: 'ROE', value: pickMetric(quote as Record<string, unknown> | null, financials, ['roe', 'roe_ttm']) },
      { label: '市值', value: pickMetric(quote as Record<string, unknown> | null, financials, ['market_cap', 'total_market_cap']) },
    ],
    [financials, quote],
  )
  const displayName = useMemo(() => {
    const financialName = financials.find((row) => typeof row.name === 'string' && row.name)?.name
    if (typeof financialName === 'string' && financialName.trim()) return financialName
    if (typeof (quote as { name?: string } | null)?.name === 'string' && quote?.name?.trim()) return quote.name
    return symbol
  }, [financials, quote, symbol])
  const latestVolume = useMemo(() => {
    const latestCandle = klineQuery.data?.data?.[klineQuery.data.data.length - 1]
    return latestCandle?.volume ?? null
  }, [klineQuery.data?.data])
  const sentimentDistribution = useMemo(() => newsMeta?.sentiment_distribution ?? fallbackSentimentDistribution(news), [news, newsMeta?.sentiment_distribution])
  const sentimentDistributionRows = useMemo(() => {
    const total = sentimentDistribution.positive + sentimentDistribution.neutral + sentimentDistribution.negative
    return [
      { key: 'positive', label: 'positive', value: sentimentDistribution.positive, tone: 'bg-emerald-400' },
      { key: 'neutral', label: 'neutral', value: sentimentDistribution.neutral, tone: 'bg-slate-400' },
      { key: 'negative', label: 'negative', value: sentimentDistribution.negative, tone: 'bg-rose-400' },
    ].map((item) => ({
      ...item,
      share: total > 0 ? item.value / total : 0,
    }))
  }, [sentimentDistribution])
  const averageSentiment = useMemo(() => {
    const values = news
      .map((item) => item.sentiment)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    if (values.length === 0) return null
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }, [news])
  const totalWindowArticles = newsMeta?.total ?? news.length
  const pageError =
    (summaryQuery.error && extractApiError(summaryQuery.error, 'failed to load summary')) ||
    (klineQuery.error && extractApiError(klineQuery.error, 'failed to load kline')) ||
    null
  const newsError = newsQuery.error ? extractApiError(newsQuery.error, 'failed to load symbol news') : null
  const eventsError = eventsQuery.error ? extractApiError(eventsQuery.error, 'failed to load event history') : null
  const financialsError = financialsQuery.error ? extractApiError(financialsQuery.error, 'failed to load financials') : null
  const marginError = marginQuery.error ? extractApiError(marginQuery.error, 'failed to load margin flow') : null
  const bigOrderError = bigOrderQuery.error ? extractApiError(bigOrderQuery.error, 'failed to load big order flow') : null
  const dragonError = dragonQuery.error ? extractApiError(dragonQuery.error, 'failed to load dragon tiger data') : null
  const northboundError = northboundQuery.error ? extractApiError(northboundQuery.error, 'failed to load northbound flow') : null

  return (
    <div data-page="market-detail" className="grid gap-6">
      <Card className="panel-dark overflow-hidden">
        <div className="panel-orbit absolute inset-0" />
        <div className="relative p-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={toneTone(quote?.change_pct_24h)} className="border-white/10 bg-white/10 text-white">
                  {displayPercent(quote?.change_pct_24h)}
                </Badge>
                <Badge tone="warning" className="border-white/10 bg-white/10 text-cyan-200">
                  {displayText(quote?.asset_type, 'asset')}
                </Badge>
                <Badge tone="muted" className="border-white/10 bg-white/10 text-slate-200">
                  source {displayText(quoteMeta?.source ?? quote?.source, 'unknown')}
                </Badge>
                <Badge tone="muted" className="border-white/10 bg-white/10 text-slate-200">
                  provider {displayText(quoteMeta?.provider, 'unknown')}
                </Badge>
                <Badge tone={quoteMeta?.stale ? 'warning' : 'positive'} className="border-white/10 bg-white/10 text-slate-200">
                  stale {String(Boolean(quoteMeta?.stale))}
                </Badge>
              </div>
              <div className="mt-5 flex flex-wrap items-end gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-300">name</p>
                  <p className="mt-2 text-xl font-medium tracking-tight text-slate-100">{displayText(displayName, symbol)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-300">symbol</p>
                  <p className="mt-2 text-4xl font-semibold tracking-tight">{symbol}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-300">last</p>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">{displayFixed(quote?.price)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-slate-300">volume</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight">{displayLocaleNumber(latestVolume)}</p>
                </div>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
                行情页现在直接吃 `/api/v2/market/{'{symbol}'}/kline` 的 intraday 能力，并把 symbol-linked news marker、财务、A 股资金流和回测入口收在一屏。
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3 xl:w-full xl:max-w-xl">
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <p className="text-xs uppercase tracking-widest text-slate-300">as of</p>
                <p className="mt-2 text-sm font-semibold text-white">{formatAsOf(quoteMeta?.as_of ?? quote?.as_of)}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <p className="text-xs uppercase tracking-widest text-slate-300">candles</p>
                <p className="mt-2 text-sm font-semibold text-white">{candles.length}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-4">
                <p className="text-xs uppercase tracking-widest text-slate-300">chart markers</p>
                <p className="mt-2 text-sm font-semibold text-white">{chartMarkers.length}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant="secondary"
              className="rounded-2xl border-white/10 bg-white/10 text-white hover:bg-white/14 hover:text-white"
              onClick={() => addWatchlistMutation.mutate()}
              disabled={addWatchlistMutation.isPending}
            >
              <ShieldPlus className="h-4 w-4" />
              {addWatchlistMutation.isPending ? 'Saving' : addWatchlistMutation.isSuccess ? 'Added' : '加入自选'}
            </Button>
            <Button asChild className="rounded-2xl bg-cyan-400 text-slate-950 hover:bg-cyan-300">
              <Link to={`/backtest?symbol=${encodeURIComponent(symbol)}&asset_type=${encodeURIComponent(inferSymbolType(symbol, quote?.asset_type))}`}>
                进入回测台
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 2xl:grid-cols-3">
        <Card id="workspace-chart" data-layout-role="primary" className="p-6 2xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <CandlestickChart className="h-5 w-5 text-cyan-600" />
                Kline
              </CardTitle>
              <CardDescription>主任务: 在这里完成周期切换、指标切换与图表决策，并结合 source/stale/as_of 判断数据可用性。</CardDescription>
            </div>
            <Badge tone={klineMeta?.stale ? 'warning' : 'positive'}>
              {displayText(klineMeta?.source, 'unknown')} · {displayText(klineMeta?.resolved_period, period)}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone="muted">provider {displayText(klineMeta?.provider, 'unknown')}</Badge>
              <Badge tone="muted">fetch {displayText(klineMeta?.fetch_source, 'unknown')}</Badge>
              <Badge tone={klineMeta?.stale ? 'warning' : 'positive'}>stale {String(Boolean(klineMeta?.stale))}</Badge>
              <Badge tone="muted">as_of {formatAsOf(klineMeta?.as_of)}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {PERIOD_OPTIONS.map((item) => (
                <Button key={item.value} variant={period === item.value ? 'primary' : 'chip'} size="sm" onClick={() => setPeriod(item.value)}>
                  {item.label}
                </Button>
              ))}
            </div>
            <IndicatorPanel
              selected={selectedIndicators}
              onToggle={(name) =>
                setSelectedIndicators((prev) => (prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]))
              }
              options={['MA', 'EMA', 'BOLL']}
              title="Overlay indicators"
            />
            <div className="flex flex-wrap gap-2">
              {OSCILLATOR_OPTIONS.map((item) => (
                <Button key={item} variant={oscillator === item ? 'primary' : 'chip'} size="sm" onClick={() => setOscillator(item)}>
                  {item}
                </Button>
              ))}
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
              <KlineChart
                candles={candles}
                showMA={selectedIndicators.includes('MA')}
                showEMA={selectedIndicators.includes('EMA')}
                showBOLL={selectedIndicators.includes('BOLL')}
                oscillator={oscillator}
                markers={chartMarkers}
                height={420}
                secondaryHeight={170}
              />
            </div>
            {pageError ? <p className="text-sm text-rose-600">{pageError}</p> : null}
            {eventsError ? <InlineError message={eventsError} /> : null}
            <div className="rounded-3xl border border-slate-200 bg-white/80 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Detail Console</p>
                  <p className="mt-1 text-sm text-slate-500">Keep kline and detail tabs in the same reading zone.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ['news', '相关新闻', Newspaper],
                    ['financials', '财务快照', BookText],
                    ['flow', '资金流向', Waves],
                    ['dragon', '龙虎榜', Landmark],
                  ] as Array<[DetailTab, string, typeof Newspaper]>).map(([key, label, Icon]) => (
                    <Button
                      key={key}
                      variant={activeTab === key ? 'primary' : 'chip'}
                      size="sm"
                      onClick={() => setActiveTab(key)}
                      disabled={(key === 'flow' || key === 'dragon') && !isAShare}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="mt-5">
                {activeTab === 'news' ? (
                  <div className="grid gap-3">
                    {newsError ? <InlineError message={newsError} /> : null}
                    {visibleNews.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          'rounded-3xl border border-slate-200 border-l-4 bg-slate-50/90 p-4',
                          item.sentiment && item.sentiment > 0
                            ? 'border-l-emerald-400'
                            : item.sentiment && item.sentiment < 0
                              ? 'border-l-rose-400'
                              : 'border-l-slate-300',
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={toneTone(item.sentiment)}>{displayFixed(item.sentiment, 2)}</Badge>
                            <span className="text-xs uppercase tracking-widest text-slate-400">{item.source} · {formatAsOf(item.published_at)}</span>
                          </div>
                          <ImportanceStars value={item.importance} />
                        </div>
                        <p className="mt-3 font-semibold text-slate-950">{item.title}</p>
                        <p className="mt-2 text-safe-wrap text-sm leading-7 text-slate-500">
                          {displayPreviewText(item.llm_summary ?? item.llm_impact, 180, 'No analysis yet.')}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(item.categories ?? []).slice(0, 2).map((entry) => (
                            <Badge key={`${item.id}-category-${entry}`} tone="warning">{entry}</Badge>
                          ))}
                          {(item.symbols ?? []).slice(0, 3).map((entry) => (
                            <Badge key={`${item.id}-symbol-${entry}`} tone="muted">{entry}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                    {visibleNews.length === 0 && !newsError ? <p className="text-sm text-slate-500">No symbol-linked news.</p> : null}
                  </div>
                ) : null}

                {activeTab === 'financials' ? (
                  <div>
                    <div className="mb-5 flex flex-wrap gap-2">
                      {([
                        ['income', '利润表'],
                        ['balance', '资产负债表'],
                        ['cashflow', '现金流量表'],
                      ] as Array<[FinancialReportType, string]>).map(([value, label]) => (
                        <Button key={value} variant={financialReportType === value ? 'primary' : 'chip'} size="sm" onClick={() => setFinancialReportType(value)}>
                          {label}
                        </Button>
                      ))}
                      {([
                        ['annual', 'annual'],
                        ['quarterly', 'quarterly'],
                      ] as Array<[FinancialPeriod, string]>).map(([value, label]) => (
                        <Button key={value} variant={financialPeriod === value ? 'primary' : 'chip'} size="sm" onClick={() => setFinancialPeriod(value)}>
                          {label}
                        </Button>
                      ))}
                      <Badge tone="muted">
                        {displayText(financialsQuery.data?.meta?.report_type, financialReportType)} · {displayText(financialsQuery.data?.meta?.period, financialPeriod)}
                      </Badge>
                    </div>
                    <div className="overflow-x-auto">
                      {financialsError ? <InlineError message={financialsError} /> : null}
                      <table className="min-w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-400">
                            {financials[0] ? Object.keys(financials[0]).slice(0, 6).map((key) => <th key={key} className="pb-3 pr-4 font-medium">{key}</th>) : null}
                          </tr>
                        </thead>
                        <tbody>
                          {financials.slice(0, 6).map((row, index) => (
                            <tr key={`financial-${index}`} className="border-b border-slate-100 last:border-0">
                              {Object.keys(financials[0] ?? {}).slice(0, 6).map((key) => (
                                <td key={key} className="py-3 pr-4 text-slate-700">{displayText(row[key])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {financials.length === 0 && !financialsError ? <p className="pt-3 text-sm text-slate-500">No financial rows.</p> : null}
                    </div>
                  </div>
                ) : null}

                {activeTab === 'flow' ? (
                  <div className="grid gap-6 xl:grid-cols-3">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                      <p className="text-sm font-semibold text-slate-950">融资融券</p>
                      {marginError ? <div className="mt-3"><InlineError message={marginError} /></div> : null}
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-400">
                              <th className="pb-3 pr-4 font-medium">Date</th>
                              <th className="pb-3 pr-4 font-medium">RZYE</th>
                              <th className="pb-3 pr-4 font-medium">RZMRE</th>
                              <th className="pb-3 pr-4 font-medium">RZRQYE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {marginRows.slice(0, 8).map((row: CnFlowRow) => (
                              <tr key={`${row.trade_date}-margin`} className="border-b border-slate-100 last:border-0">
                                <td className="py-3 pr-4 text-slate-500">{row.trade_date}</td>
                                <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.rzye)}</td>
                                <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.rzmre)}</td>
                                <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.rzrqye)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {marginRows.length === 0 && !marginError ? <p className="pt-3 text-sm text-slate-500">No margin rows.</p> : null}
                      </div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                      <p className="text-sm font-semibold text-slate-950">大单流向</p>
                      {bigOrderError ? <div className="mt-3"><InlineError message={bigOrderError} /></div> : null}
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-400">
                              <th className="pb-3 pr-4 font-medium">Date</th>
                              <th className="pb-3 pr-4 font-medium">Main</th>
                              <th className="pb-3 pr-4 font-medium">Super</th>
                              <th className="pb-3 pr-4 font-medium">Large</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bigOrderRows.slice(0, 8).map((row: CnFlowRow) => (
                              <tr key={`${row.trade_date}-big-order`} className="border-b border-slate-100 last:border-0">
                                <td className="py-3 pr-4 text-slate-500">{row.trade_date}</td>
                                <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.main_net)}</td>
                                <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.super_large_net)}</td>
                                <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.large_net)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {bigOrderRows.length === 0 && !bigOrderError ? <p className="pt-3 text-sm text-slate-500">No big order rows.</p> : null}
                      </div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                      <p className="text-sm font-semibold text-slate-950">北向资金</p>
                      {northboundError ? <div className="mt-3"><InlineError message={northboundError} /></div> : null}
                      <div className="mt-3 overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-400">
                              <th className="pb-3 pr-4 font-medium">Date</th>
                              <th className="pb-3 pr-4 font-medium">Market</th>
                              <th className="pb-3 pr-4 font-medium">Net Buy</th>
                              <th className="pb-3 pr-4 font-medium">Buy</th>
                              <th className="pb-3 pr-4 font-medium">Sell</th>
                            </tr>
                          </thead>
                          <tbody>
                            {northboundRows.slice(0, 10).map((row: CnFlowRow) => (
                              <tr key={`${row.trade_date}-${(row as { market?: string }).market ?? northboundMarket}-northbound`} className="border-b border-slate-100 last:border-0">
                                <td className="py-3 pr-4 text-slate-500">{row.trade_date}</td>
                                <td className="py-3 pr-4 text-slate-700">{displayText((row as { market?: string }).market, northboundMarket.toUpperCase())}</td>
                                <td className={cn('py-3 pr-4', (row.net_buy ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                                  {displayLocaleNumber(row.net_buy)}
                                </td>
                                <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.buy_amount)}</td>
                                <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.sell_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {northboundRows.length === 0 && !northboundError ? <p className="pt-3 text-sm text-slate-500">No northbound flow data.</p> : null}
                      </div>
                    </div>
                    {eventsError ? <InlineError message={eventsError} /> : null}
                  </div>
                ) : null}

                {activeTab === 'dragon' ? (
                  <div className="overflow-x-auto">
                    {dragonError ? <InlineError message={dragonError} /> : null}
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-400">
                          <th className="pb-3 pr-4 font-medium">Date</th>
                          <th className="pb-3 pr-4 font-medium">Reason</th>
                          <th className="pb-3 pr-4 font-medium">Net Buy</th>
                          <th className="pb-3 pr-4 font-medium">Buy</th>
                          <th className="pb-3 pr-4 font-medium">Sell</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dragonRows.slice(0, 10).map((row: DragonTigerRow) => (
                          <tr key={`${row.trade_date}-${row.reason}`} className="border-b border-slate-100 last:border-0">
                            <td className="py-3 pr-4 text-slate-500">{row.trade_date}</td>
                            <td className="py-3 pr-4 text-slate-700">{displayText(row.reason)}</td>
                            <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.net_buy)}</td>
                            <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.buy_amount)}</td>
                            <td className="py-3 pr-4 text-slate-700">{displayLocaleNumber(row.sell_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {dragonRows.length === 0 && !dragonError ? <p className="pt-3 text-sm text-slate-500">No dragon tiger rows.</p> : null}
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <div data-layout-role="secondary" className="grid gap-6">
          <Card className="p-6">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-cyan-600" />
                  Quick Context
                </CardTitle>
                <CardDescription>Keep the chart primary. This rail only carries the fastest context you need before deciding what to do on the chart.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {fixedFundamentals.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                    <p className="text-xs uppercase tracking-widest text-slate-400">{item.label}</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">
                      {item.label === '市值' ? displayLocaleNumber(item.value) : displayFixed(item.value)}
                    </p>
                  </div>
                ))}
              </div>
              {fundamentals.length === 0 && !financialsError ? <p className="text-sm text-slate-500">No quick fundamental snapshot.</p> : null}
              {financialsError ? <InlineError message={financialsError} /> : null}
              <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                <div className="flex items-center gap-2">
                  <Sigma className="h-4 w-4 text-cyan-600" />
                  <p className="text-sm font-semibold text-slate-950">30D Sentiment Distribution</p>
                </div>
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-widest text-slate-400">coverage 30D</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">{displayText(totalWindowArticles, '0')}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {newsWindowStart} → {newsWindowEnd}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-widest text-slate-400">average sentiment</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">{displayFixed(averageSentiment, 2)}</p>
                      <p className="mt-1 text-xs text-slate-500">computed from the current 30D symbol-linked news window</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
                      <p className="text-xs uppercase tracking-widest text-slate-400">as_of</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">{formatAsOf(newsMeta?.as_of)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        source {displayText(newsMeta?.source, 'persisted')} · stale {String(Boolean(newsMeta?.stale))}
                      </p>
                    </div>
                  </div>
                  {sentimentDistributionRows.map((item) => (
                    <div key={item.key} className="grid gap-2">
                      <div className="flex items-center justify-between text-xs uppercase tracking-widest text-slate-400">
                        <span>{item.label}</span>
                        <span>
                          {item.value} · {displayPercent(item.share)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className={cn('h-full rounded-full', item.tone)}
                          style={{ width: `${Math.min(100, Math.max(10, item.share * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  {totalWindowArticles === 0 ? <p className="text-sm text-slate-500">No 30D sentiment distribution yet.</p> : null}
                </div>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-slate-400">History Coverage</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{displayText(historyStatus?.local_rows, '0')} rows cached</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {displayText(historyStatus?.local_start, 'n/a')} → {displayText(historyStatus?.local_end, 'n/a')}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => syncHistoryMutation.mutate()} disabled={syncHistoryMutation.isPending}>
                    {syncHistoryMutation.isPending ? 'Syncing' : 'Sync 3Y'}
                  </Button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge tone={historyStatus?.has_data ? 'positive' : 'warning'}>{historyStatus?.has_data ? 'coverage ready' : 'coverage empty'}</Badge>
                  <Badge tone="muted">quote {formatAsOf(quoteMeta?.as_of ?? quote?.as_of)}</Badge>
                  <Badge tone="muted">kline {formatAsOf(klineMeta?.as_of)}</Badge>
                </div>
                {syncHistoryMutation.isError ? (
                  <p className="mt-3 text-sm text-rose-600">{extractApiError(syncHistoryMutation.error, 'failed to sync history')}</p>
                ) : null}
                {syncHistoryMutation.isSuccess ? (
                  <p className="mt-3 text-sm text-emerald-700">
                    synced {displayText(syncHistoryMutation.data?.data?.rows_synced, '0')} rows
                  </p>
                ) : null}
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4 text-xs text-slate-500">
                <p>quote provider {displayText(quoteMeta?.provider, 'unknown')}</p>
                <p>quote as_of {formatAsOf(quoteMeta?.as_of ?? quote?.as_of)}</p>
                <p>kline provider {displayText(klineMeta?.provider, 'unknown')}</p>
                <p>kline as_of {formatAsOf(klineMeta?.as_of)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="p-6">
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Newspaper className="h-5 w-5 text-cyan-600" />
                  Signal Notes
                </CardTitle>
                <CardDescription>Keep only the most recent signal notes here. The deeper reference console stays below as a separate zone.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-3xl border border-slate-200 bg-slate-50/90 p-4">
                <p className="text-xs uppercase tracking-widest text-slate-400">active detail panel</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">
                  {activeTab === 'news' ? '相关新闻' : activeTab === 'financials' ? '财务快照' : activeTab === 'flow' ? '资金流向' : '龙虎榜'}
                </p>
                <p className="mt-2 text-xs text-slate-500">news {totalWindowArticles} · events {events.length} · financials {financials.length}</p>
              </div>
              <div className="space-y-3">
                {newsError ? <InlineError message={newsError} /> : null}
                {signalNotes.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-3xl border border-slate-200 border-l-4 bg-slate-50/90 p-4',
                      item.sentiment && item.sentiment > 0
                        ? 'border-l-emerald-400'
                        : item.sentiment && item.sentiment < 0
                          ? 'border-l-rose-400'
                          : 'border-l-slate-300',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={toneTone(item.sentiment)}>{displayFixed(item.sentiment, 2)}</Badge>
                        <span className="text-xs uppercase tracking-widest text-slate-400">{formatAsOf(item.published_at)}</span>
                      </div>
                      <ImportanceStars value={item.importance} />
                    </div>
                    <p className="mt-3 font-semibold text-slate-950">{item.title}</p>
                    <p className="mt-2 text-safe-wrap text-sm leading-7 text-slate-500">
                      {displayPreviewText(item.llm_impact ?? item.llm_summary, 120, 'No analysis yet.')}
                    </p>
                  </div>
                ))}
                {signalNotes.length === 0 && !newsError ? <p className="text-sm text-slate-500">No symbol-linked news.</p> : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
