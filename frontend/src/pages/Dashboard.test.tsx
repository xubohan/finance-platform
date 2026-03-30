import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DashboardPage from './Dashboard'

const mockGetCnFlowHeatmap = vi.fn()
const mockGetCorrelation = vi.fn()
const mockGetSectorHeatmap = vi.fn()
const mockGetEventCalendar = vi.fn()
const mockGetBatchQuotes = vi.fn()
const mockGetNorthbound = vi.fn()
const mockGetNewsFeed = vi.fn()
const mockGetDataStatus = vi.fn()
const mockGetHealth = vi.fn()
const mockAddWatchlistItem = vi.fn()
const mockGetWatchlistQuotes = vi.fn()
const mockRemoveWatchlistItem = vi.fn()

vi.mock('../api/analysis', () => ({
  getCnFlowHeatmap: (...args: unknown[]) => mockGetCnFlowHeatmap(...args),
  getCorrelation: (...args: unknown[]) => mockGetCorrelation(...args),
  getSectorHeatmap: (...args: unknown[]) => mockGetSectorHeatmap(...args),
}))

vi.mock('../api/events', () => ({
  getEventCalendar: (...args: unknown[]) => mockGetEventCalendar(...args),
}))

vi.mock('../api/market', () => ({
  getBatchQuotes: (...args: unknown[]) => mockGetBatchQuotes(...args),
  getNorthbound: (...args: unknown[]) => mockGetNorthbound(...args),
}))

vi.mock('../api/news', () => ({
  getNewsFeed: (...args: unknown[]) => mockGetNewsFeed(...args),
}))

vi.mock('../api/system', () => ({
  getDataStatus: (...args: unknown[]) => mockGetDataStatus(...args),
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}))

vi.mock('../api/watchlist', () => ({
  addWatchlistItem: (...args: unknown[]) => mockAddWatchlistItem(...args),
  getWatchlistQuotes: (...args: unknown[]) => mockGetWatchlistQuotes(...args),
  removeWatchlistItem: (...args: unknown[]) => mockRemoveWatchlistItem(...args),
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    class MockIntersectionObserver {
      private callback: IntersectionObserverCallback

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
      }

      observe(target: Element) {
        this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }

      disconnect() {}

      unobserve() {}

      takeRecords() {
        return []
      }
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

    mockGetWatchlistQuotes.mockResolvedValue({ data: [], meta: { as_of: '2026-03-28T00:00:00Z' } })
    mockAddWatchlistItem.mockResolvedValue({ data: null, meta: {} })
    mockRemoveWatchlistItem.mockResolvedValue({ data: null, meta: {} })
    mockGetNewsFeed.mockImplementation(async (params?: { page?: number; category?: string; market?: string }) => {
      const page = Number(params?.page ?? 1)
      const macro = params?.category === 'macro'
      const firstPage = {
        id: macro ? 11 : 1,
        title: macro ? 'Macro headline' : 'Page one headline',
        source: 'wire',
        published_at: '2026-03-28T00:00:00Z',
        symbols: macro ? ['SPY'] : ['AAPL'],
        categories: macro ? ['macro'] : ['earnings'],
        markets: [macro ? 'us' : 'us'],
        sentiment: macro ? 0.35 : 0.2,
        importance: 3,
        llm_summary: macro ? 'macro summary' : 'page one summary',
      }
      const secondPage = {
        id: 2,
        title: 'Page two headline',
        source: 'wire',
        published_at: '2026-03-28T01:00:00Z',
        symbols: ['MSFT'],
        categories: ['policy'],
        markets: ['us'],
        sentiment: 0.1,
        importance: 2,
        llm_summary: 'page two summary',
      }
      return {
        data: [page === 1 ? firstPage : secondPage],
        meta: {
          page,
          page_size: 6,
          total: 12,
          source: 'live',
          stale: false,
          as_of: page === 1 ? '2026-03-28T00:00:00Z' : '2026-03-28T01:00:00Z',
          market: params?.market ?? 'all',
        },
      }
    })
    mockGetEventCalendar.mockResolvedValue({ data: [], meta: { source: 'live', stale: false, as_of: '2026-03-28T00:00:00Z' } })
    mockGetHealth.mockResolvedValue({ status: 'ok', version: 'test' })
    mockGetDataStatus.mockResolvedValue({
      data: {
        provider_health: { summary: { status: 'ok' }, checks: [] },
        stock_quote_aapl: {
          symbol: 'AAPL',
          asset_type: 'stock',
          status: 'ok',
          source: 'live',
          provider: 'tencent',
          stale: false,
          as_of: '2026-03-28T00:00:00Z',
          price: 222.15,
          change_pct_24h: 1.24,
        },
        crypto_quote_btc: {
          symbol: 'BTC',
          asset_type: 'crypto',
          status: 'ok',
          source: 'live',
          provider: 'binance',
          stale: false,
          as_of: '2026-03-28T00:00:00Z',
          price: 84500.12,
          change_pct_24h: 2.51,
        },
        datasets: {
          status: 'ok',
          news_items_total: 128,
          news_items_last_24h: 22,
          latest_news_at: '2026-03-28T00:00:00Z',
          market_events_total: 43,
          upcoming_events_30d: 9,
          latest_event_at: '2026-03-28T00:00:00Z',
          watchlist_items_total: 7,
        },
        llm: { configured: true, model: 'gpt-5.3-codex', api_style: 'openai', base_url: 'https://example.com', endpoint_path: '/v1/chat/completions' },
      },
      meta: { generated_at: '2026-03-28T00:00:00Z', served_from_cache: false, cache_ttl_sec: 15 },
    })
    mockGetSectorHeatmap.mockResolvedValue({ data: [], meta: { source: 'live', stale: false, as_of: '2026-03-28T00:00:00Z' } })
    mockGetCnFlowHeatmap.mockResolvedValue({ data: [], meta: { generated_at: '2026-03-28T00:00:00Z' } })
    mockGetCorrelation.mockResolvedValue({ data: { symbols: [], matrix: [] }, meta: { rows: 0 } })
    mockGetNorthbound.mockResolvedValue({ data: [], meta: { source: 'live', stale: false, as_of: '2026-03-28T00:00:00Z', count: 0 } })
    mockGetBatchQuotes.mockResolvedValue({ data: [], meta: {} })
  })

  it('auto-loads the next news page when the sentinel enters view', async () => {
    renderPage()

    expect(await screen.findByText('Page one headline')).toBeInTheDocument()
    expect(screen.getByLabelText('importance 3 of 5')).toBeInTheDocument()
    expect(screen.queryByText(/live signal stream/i)).toBeNull()
    expect(screen.queryByText(/analysis live/i)).toBeNull()

    await waitFor(() => {
      expect(mockGetNewsFeed).toHaveBeenCalledWith(expect.objectContaining({ page: 2, page_size: 6, market: 'all' }))
    })

    expect(await screen.findByText('Page two headline')).toBeInTheDocument()
  })

  it('maps the macro tab to the live macro category instead of pretending it is a market', async () => {
    renderPage()

    await screen.findByText('Page one headline')
    await userEvent.click(screen.getByRole('button', { name: 'macro' }))

    await waitFor(() => {
      expect(mockGetNewsFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          page_size: 6,
          market: 'all',
          category: 'macro',
        }),
      )
    })
    expect(await screen.findByText('Macro headline')).toBeInTheDocument()
  })

  it('renders runtime live samples and dataset coverage from the system status payload', async () => {
    renderPage()

    expect(await screen.findByText(/AAPL · stock/i)).toBeInTheDocument()
    expect(screen.getByText(/BTC · crypto/i)).toBeInTheDocument()
    expect(screen.getByText('222.15')).toBeInTheDocument()
    expect(screen.getByText('84500.12')).toBeInTheDocument()
    expect(screen.getByText(/22 \/ 128/i)).toBeInTheDocument()
    expect(screen.getByText(/9 \/ 43/i)).toBeInTheDocument()
    expect(screen.getByText(/^7$/)).toBeInTheDocument()
  })
})
