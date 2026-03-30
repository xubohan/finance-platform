import { useQuery } from '@tanstack/react-query'
import { Activity, Bot, CandlestickChart, CalendarRange, Command, Globe2, Newspaper, Radar, Search, Workflow } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import { extractApiError } from '../../api/client'
import { searchAssets, type SearchAsset } from '../../api/market'
import { getDataStatus, getHealth } from '../../api/system'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { BACKGROUND_REFRESH_QUERY_OPTIONS, QUERY_REFRESH_MS } from '../../lib/query-refresh'
import { formatAsOf } from '../../utils/time'

type Props = {
  children: ReactNode
}

type RouteCopyItem = {
  matcher: (pathname: string) => boolean
  title: string
  body: string
  eyebrow: string
  focus: string
}

const navItems = [
  { to: '/', label: 'Dashboard', hint: 'board + watchlist', icon: Activity },
  { to: '/workspace', label: 'Workspace', hint: 'search + runtime', icon: Command },
  { to: '/market/AAPL', label: 'Market', hint: 'symbol cockpit', icon: CandlestickChart },
  { to: '/news', label: 'News', hint: 'signal stream', icon: Newspaper },
  { to: '/events', label: 'Events', hint: 'calendar + impact', icon: CalendarRange },
  { to: '/backtest', label: 'Backtest', hint: 'quant lab', icon: Workflow },
  { to: '/screener', label: 'Screener', hint: 'factor radar', icon: Radar },
]

const routeCopy: RouteCopyItem[] = [
  {
    matcher: (pathname) => pathname === '/workspace',
    eyebrow: 'Workspace',
    title: 'Use the broad workspace for discovery, movers, watchlists, and runtime controls.',
    body: 'This route keeps search, shortlist building, and operational checks together so focused pages can stay narrower.',
    focus: 'Focus: search, movers, watchlist, runtime',
  },
  {
    matcher: (pathname) => pathname === '/',
    eyebrow: 'Command Board',
    title: 'Use the dashboard as a jumpboard, not as the place where heavy work happens.',
    body: 'Scan the market, see what changed today, and jump into the page that owns the next decision.',
    focus: 'Focus: market pulse, today focus, runtime health',
  },
  {
    matcher: (pathname) => pathname.startsWith('/market/'),
    eyebrow: 'Symbol Cockpit',
    title: 'Stay on one symbol and make chart-first decisions with minimal context switching.',
    body: 'Price action stays primary. News, fundamentals, and reference data support the chart instead of competing with it.',
    focus: 'Focus: live kline, quick context, reference console',
  },
  {
    matcher: (pathname) => pathname === '/news',
    eyebrow: 'Signal Stream',
    title: 'Filter the stream first, then judge what deserves attention.',
    body: 'The news page is for ranking signal density and deciding what to investigate next.',
    focus: 'Focus: filters, stream, sentiment stats',
  },
  {
    matcher: (pathname) => pathname === '/events',
    eyebrow: 'Impact Calendar',
    title: 'Browse the calendar, inspect one event, then decide whether it needs analysis.',
    body: 'The events page now keeps the browser and inspector distinct so the next action is always obvious.',
    focus: 'Focus: event browser, event inspector, recent history',
  },
  {
    matcher: (pathname) => pathname === '/backtest',
    eyebrow: 'Quant Workbench',
    title: 'Run one experiment loop at a time and read the result without layout noise.',
    body: 'Controls, result canvas, and experiment memory now have fixed jobs and a clearer hierarchy.',
    focus: 'Focus: run controls, result canvas, experiment memory',
  },
  {
    matcher: (pathname) => pathname === '/screener',
    eyebrow: 'Radar Sweep',
    title: 'Screen first, then open the drawer only when a shortlist is worth acting on.',
    body: 'Selection and batch actions are now downstream of the shortlist instead of sharing the same visual weight.',
    focus: 'Focus: controls, shortlist, action drawer',
  },
]

function getSessionStatus(timeZone: string, openHour: number, openMinute: number, closeHour: number, closeMinute: number) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = formatter.formatToParts(new Date())
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  const isWeekday = !['Sat', 'Sun'].includes(weekday)
  const nowMinutes = hour * 60 + minute
  const openMinutes = openHour * 60 + openMinute
  const closeMinutes = closeHour * 60 + closeMinute
  if (isWeekday && nowMinutes >= openMinutes && nowMinutes <= closeMinutes) {
    return { label: 'open', tone: 'positive' as const }
  }
  return { label: 'closed', tone: 'muted' as const }
}

function formatProviderLine(name?: string, status?: string) {
  const safeName = (name ?? 'unknown').replaceAll('_', ' ')
  const safeStatus = (status ?? 'unknown').replaceAll('_', ' ')
  return `${safeName} · ${safeStatus}`
}

export default function AppShell({ children }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const [symbolInput, setSymbolInput] = useState('')
  const normalizedSearch = symbolInput.trim()
  const copy = routeCopy.find((item) => item.matcher(location.pathname)) ?? routeCopy[0]
  const cnSession = getSessionStatus('Asia/Shanghai', 9, 30, 15, 0)
  const usSession = getSessionStatus('America/New_York', 9, 30, 16, 0)
  const shellRuntimeQuery = useQuery({
    ...BACKGROUND_REFRESH_QUERY_OPTIONS,
    queryKey: ['shell-runtime-status'],
    queryFn: async () => {
      const [healthResult, dataStatusResult] = await Promise.allSettled([getHealth(), getDataStatus()])
      const health = healthResult.status === 'fulfilled' ? healthResult.value : { status: 'request_failed' }
      const dataStatus = dataStatusResult.status === 'fulfilled' ? dataStatusResult.value : { data: {}, meta: {} }
      return {
        health,
        dataStatus,
        requestFailed: {
          health: healthResult.status === 'rejected',
          dataStatus: dataStatusResult.status === 'rejected',
        },
      }
    },
    staleTime: 20_000,
    refetchInterval: QUERY_REFRESH_MS.shellRuntime,
  })
  const shellSearchQuery = useQuery({
    queryKey: ['shell-asset-search', normalizedSearch],
    queryFn: () => searchAssets(normalizedSearch, 'all', 8),
    enabled: normalizedSearch.length > 0 && !normalizedSearch.toLowerCase().startsWith('news:'),
    staleTime: 20_000,
  })
  const providerChecks = shellRuntimeQuery.data?.dataStatus?.data?.provider_health?.checks ?? []
  const stockSample = shellRuntimeQuery.data?.dataStatus?.data?.stock_quote_aapl
  const cryptoSample = shellRuntimeQuery.data?.dataStatus?.data?.crypto_quote_btc
  const searchResults = shellSearchQuery.data?.data ?? []
  const searchError = shellSearchQuery.error ? extractApiError(shellSearchQuery.error, 'failed to search assets') : null
  const providerSummary = useMemo(() => {
    return providerChecks.slice(0, 3).map((item) => formatProviderLine(item.name, item.status))
  }, [providerChecks])
  const providerAggregate = useMemo(() => {
    const summaryStatus = shellRuntimeQuery.data?.dataStatus?.data?.provider_health?.summary?.status ?? 'unknown'
    const counts = providerChecks.reduce<Record<string, number>>((accumulator, check) => {
      const key = (check.status ?? 'unknown').toLowerCase()
      accumulator[key] = (accumulator[key] ?? 0) + 1
      return accumulator
    }, {})
    const degradedCount = counts.degraded ?? 0
    const errorCount = counts.error ?? 0
    const sources = Array.from(
      new Set(
        providerChecks
          .map((check) => {
            const details = check.details as { source?: string } | undefined
            return details?.source
          })
          .filter((source): source is string => typeof source === 'string' && source.trim().length > 0),
      ),
    )
    return {
      summaryStatus,
      degradedCount,
      errorCount,
      total: providerChecks.length,
      sources,
      sourcesLabel: sources.length > 0 ? sources.join(', ') : 'unknown',
    }
  }, [providerChecks, shellRuntimeQuery.data?.dataStatus?.data?.provider_health?.summary?.status])
  const statusAsOf = shellRuntimeQuery.data?.dataStatus?.meta?.generated_at
  const servedFromCache = shellRuntimeQuery.data?.dataStatus?.meta?.served_from_cache
  const cacheTtlSec = shellRuntimeQuery.data?.dataStatus?.meta?.cache_ttl_sec
  const staleState =
    providerChecks.some((check) => check.details?.stale === true)
      ? 'true'
      : providerChecks.some((check) => check.details?.stale === false)
        ? 'false'
        : shellRuntimeQuery.data?.health?.status === 'ok'
          ? 'false'
          : 'possible'
  const runtimeFetchState =
    shellRuntimeQuery.data?.requestFailed?.health || shellRuntimeQuery.data?.requestFailed?.dataStatus ? 'request failed' : 'ok'
  const shellStatusItems = useMemo(
    () => [
      {
        label: 'workspace',
        value: 'multi-agent build',
      },
      {
        label: 'provider',
        value:
          providerAggregate.total > 0
            ? `${providerAggregate.summaryStatus} · degraded ${providerAggregate.degradedCount} · error ${providerAggregate.errorCount}`
            : providerAggregate.summaryStatus,
      },
      {
        label: 'source',
        value: `${providerAggregate.sourcesLabel} · stale ${staleState}`,
      },
      {
        label: 'runtime',
        value: `${shellRuntimeQuery.data?.health?.status ?? 'loading'} · ${runtimeFetchState} · ${formatAsOf(statusAsOf)}`,
      },
    ],
    [providerAggregate.degradedCount, providerAggregate.errorCount, providerAggregate.sourcesLabel, providerAggregate.summaryStatus, providerAggregate.total, runtimeFetchState, shellRuntimeQuery.data?.health?.status, staleState, statusAsOf],
  )

  const openSearchResult = (item: SearchAsset) => {
    setSymbolInput(item.symbol)
    navigate(`/market/${encodeURIComponent(item.symbol)}`)
  }

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const raw = symbolInput.trim()
    if (!raw) return
    const lower = raw.toLowerCase()
    if (lower.startsWith('news:')) {
      const query = raw.slice(5).trim()
      navigate(query ? `/news?query=${encodeURIComponent(query)}` : '/news')
      return
    }
    const exactMatch =
      searchResults.find((item) => item.symbol.toLowerCase() === raw.toLowerCase()) ??
      searchResults.find((item) => item.name.toLowerCase() === raw.toLowerCase())
    if (exactMatch) {
      openSearchResult(exactMatch)
      return
    }
    if (searchResults.length > 0) {
      openSearchResult(searchResults[0])
      return
    }
    if (/\s/.test(raw)) {
      navigate(`/news?query=${encodeURIComponent(raw)}`)
      return
    }
    navigate(`/market/${encodeURIComponent(raw.toUpperCase())}`)
  }

  return (
    <div className="relative min-h-screen overflow-hidden text-slate-950">
      <div className="app-grid-overlay pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex min-h-screen max-w-screen-2xl gap-6 px-4 py-4 lg:px-6">
        <aside className="workspace-sidebar shell-sidebar hidden w-80 shrink-0 flex-col overflow-hidden border border-slate-900/80 p-6 text-white lg:flex">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-widest text-cyan-300/80">Finance Terminal</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">Signal Engine</h1>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-cyan-300">
              <Command className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
            <Badge tone="warning" className="border-white/10 bg-cyan-400/10 text-cyan-200">
              {copy.eyebrow}
            </Badge>
            <p className="mt-4 text-lg font-medium leading-8 text-white">{copy.title}</p>
            <p className="mt-3 text-sm leading-7 text-slate-300">{copy.body}</p>
            <p className="mt-4 text-xs uppercase tracking-[0.22em] text-slate-400">{copy.focus}</p>
          </div>

          <div className="mt-6 grid gap-3">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-slate-400">Session Pulse</span>
                <Globe2 className="h-4 w-4 text-cyan-300" />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone={cnSession.tone} className="border-white/10 bg-white/5 text-white">
                  CN {cnSession.label}
                </Badge>
                <Badge tone={usSession.tone} className="border-white/10 bg-white/5 text-white">
                  US {usSession.label}
                </Badge>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-slate-400">Runtime Contract</span>
                <Bot className="h-4 w-4 text-amber-300" />
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Live-first where supported, explicit persisted or degraded states elsewhere, custom LLM endpoints, and reproducible experiments are hard delivery requirements.
              </p>
              <div className="mt-4 grid gap-2 text-xs text-slate-300">
                <p>api: /api/v2</p>
                <p>summary: {providerAggregate.summaryStatus}</p>
                <p>providers: {providerAggregate.total} · degraded {providerAggregate.degradedCount} · error {providerAggregate.errorCount}</p>
                <p>sources: {providerAggregate.sourcesLabel}</p>
                <p>stock sample: {stockSample?.symbol ?? 'AAPL'} · {stockSample?.provider ?? stockSample?.source ?? 'n/a'} · stale {String(stockSample?.stale ?? 'unknown')}</p>
                <p>crypto sample: {cryptoSample?.symbol ?? 'BTC'} · {cryptoSample?.provider ?? cryptoSample?.source ?? 'n/a'} · stale {String(cryptoSample?.stale ?? 'unknown')}</p>
                <p className="max-w-full text-safe-wrap">provider: {providerSummary.join(' · ') || 'loading'}</p>
                <p>as_of: {formatAsOf(statusAsOf)}</p>
                <p>cache: {servedFromCache ? 'hit' : 'fresh'} · ttl {cacheTtlSec ?? '-'}s</p>
                <p>stale: {staleState}</p>
                <p>request: {runtimeFetchState}</p>
              </div>
            </div>
          </div>

          <nav className="mt-6 grid gap-2">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'group rounded-3xl border px-4 py-4 transition duration-200',
                      isActive || (item.to === '/market/AAPL' && location.pathname.startsWith('/market/'))
                        ? 'border-cyan-300/40 bg-cyan-400/10 text-white shadow-sm'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10 hover:text-white',
                    )
                  }
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-2">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs uppercase tracking-widest text-slate-400 transition group-hover:text-slate-300">
                        {item.hint}
                      </p>
                    </div>
                  </div>
                </NavLink>
              )
            })}
          </nav>
        </aside>

        <div className="workspace-main flex min-w-0 flex-1 flex-col gap-6">
          <header className="workspace-quick-nav shell-glass border border-white/70 bg-white/72 p-5">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs uppercase tracking-widest text-cyan-700">{copy.eyebrow}</p>
                <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 lg:text-3xl">{copy.title}</p>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">{copy.body}</p>
              </div>
              <div className="w-full max-w-xl">
                <div className="relative">
                  <form onSubmit={handleSearch} className="flex gap-3 rounded-3xl border border-slate-200 bg-slate-950 px-4 py-3 text-white">
                    <Search className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                    <input
                      className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-slate-500"
                      value={symbolInput}
                      onChange={(event) => setSymbolInput(event.target.value)}
                      placeholder="AAPL / Apple / 600519.SH / BTC / news:fed"
                    />
                    <Button type="submit" size="sm" className="h-9 rounded-xl bg-cyan-400 px-3 text-slate-950 hover:bg-cyan-300">
                      Jump
                    </Button>
                  </form>
                  {normalizedSearch && !normalizedSearch.toLowerCase().startsWith('news:') ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-20 overflow-hidden rounded-3xl border border-slate-200 bg-white/96 shadow-2xl backdrop-blur">
                      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                        <span>Live Search</span>
                        <span>{shellSearchQuery.isFetching ? 'querying' : `${searchResults.length} matches`}</span>
                      </div>
                      <div className="grid gap-1 p-2">
                        {searchError ? <p className="rounded-2xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{searchError}</p> : null}
                        {!searchError && shellSearchQuery.isFetching ? <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-500">Searching live asset directory...</p> : null}
                        {!searchError && !shellSearchQuery.isFetching && searchResults.length === 0 ? (
                          <div className="grid gap-2 rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
                            <p>No asset match yet. Choose the next action explicitly instead of relying on a blind jump.</p>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" variant="chip" onClick={() => navigate(`/news?query=${encodeURIComponent(normalizedSearch)}`)}>
                                Search news for "{normalizedSearch}"
                              </Button>
                              <Button type="button" size="sm" variant="chip" onClick={() => navigate(`/market/${encodeURIComponent(normalizedSearch.toUpperCase())}`)}>
                                Open symbol {normalizedSearch.toUpperCase()}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                        {searchResults.map((item) => (
                          <button
                            key={`${item.asset_type}-${item.symbol}`}
                            type="button"
                            className="rounded-2xl border border-transparent px-3 py-3 text-left transition hover:border-cyan-200 hover:bg-cyan-50/60"
                            onClick={() => openSearchResult(item)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-950">{item.symbol}</p>
                                <p className="truncate text-sm text-slate-500">{item.name}</p>
                              </div>
                              <div className="flex shrink-0 flex-wrap gap-2">
                                <Badge tone="muted">{item.asset_type}</Badge>
                                <Badge tone="muted">{item.market ?? 'global'}</Badge>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-slate-200 bg-white/75 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                <span>page intent</span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600">{copy.focus}</span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                {shellStatusItems.map((item) => (
                  <div key={item.label} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/90 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                    <p className="mt-1 break-words text-sm font-medium text-slate-950">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 lg:hidden">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'rounded-full border px-4 py-2 text-sm font-medium',
                      isActive || (item.to === '/market/AAPL' && location.pathname.startsWith('/market/'))
                        ? 'border-slate-950 bg-slate-950 text-white'
                        : 'border-slate-200 bg-white/70 text-slate-600',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </header>

          <main className="min-h-0">{children}</main>
        </div>
      </div>
    </div>
  )
}
