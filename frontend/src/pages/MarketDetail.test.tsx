import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MarketDetailPage from './MarketDetail'

const mockGetMarketSummary = vi.fn()
const mockGetKline = vi.fn()
const mockGetNewsFeed = vi.fn()
const mockGetEventHistory = vi.fn()
const mockGetFinancials = vi.fn()
const mockGetMargin = vi.fn()
const mockGetBigOrderFlow = vi.fn()
const mockGetDragonTiger = vi.fn()
const mockGetNorthbound = vi.fn()
const mockSyncHistory = vi.fn()
const mockAddWatchlistItem = vi.fn()

vi.mock('../api/market', () => ({
  getMarketSummary: (...args: unknown[]) => mockGetMarketSummary(...args),
  getKline: (...args: unknown[]) => mockGetKline(...args),
  getFinancials: (...args: unknown[]) => mockGetFinancials(...args),
  getMargin: (...args: unknown[]) => mockGetMargin(...args),
  getBigOrderFlow: (...args: unknown[]) => mockGetBigOrderFlow(...args),
  getDragonTiger: (...args: unknown[]) => mockGetDragonTiger(...args),
  getNorthbound: (...args: unknown[]) => mockGetNorthbound(...args),
  syncHistory: (...args: unknown[]) => mockSyncHistory(...args),
  toCandles: () => [],
}))

vi.mock('../api/news', () => ({
  getNewsFeed: (...args: unknown[]) => mockGetNewsFeed(...args),
}))

vi.mock('../api/events', () => ({
  getEventHistory: (...args: unknown[]) => mockGetEventHistory(...args),
}))

vi.mock('../api/watchlist', () => ({
  addWatchlistItem: (...args: unknown[]) => mockAddWatchlistItem(...args),
}))

vi.mock('../lib/query-refresh', () => ({
  BACKGROUND_REFRESH_QUERY_OPTIONS: {
    refetchIntervalInBackground: true,
  },
  QUERY_REFRESH_MS: {
    marketContext: 5_000,
    marketSlow: 5_000,
  },
  getMarketQuoteRefreshMs: () => 25,
  getMarketChartRefreshMs: () => 50,
}))

vi.mock('../components/chart/KlineChart', () => ({
  default: () => <div data-testid="kline-chart" />,
}))

vi.mock('../components/chart/IndicatorPanel', () => ({
  default: () => <div data-testid="indicator-panel" />,
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
      <MemoryRouter initialEntries={['/market/AAPL']}>
        <Routes>
          <Route path="/market/:symbol" element={<MarketDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MarketDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetMarketSummary.mockResolvedValue({
      data: {
        symbol: 'AAPL',
        asset_type: 'stock',
        quote: {
          symbol: 'AAPL',
          asset_type: 'stock',
          price: 188.1,
          change_pct_24h: 1.2,
          as_of: '2026-03-28T09:30:00Z',
          source: 'live',
          name: 'Apple',
        },
        history_status: {
          symbol: 'AAPL',
          asset_type: 'stock',
          local_rows: 25,
          local_start: '2026-02-28',
          local_end: '2026-03-28',
          has_data: true,
        },
      },
      meta: {
        quote: {
          source: 'live',
          stale: false,
          as_of: '2026-03-28T09:30:00Z',
          provider: 'yfinance',
          fetch_source: 'live',
        },
      },
    })
    mockGetKline.mockResolvedValue({
      data: [],
      meta: {
        source: 'live',
        stale: false,
        as_of: '2026-03-28T09:30:00Z',
        provider: 'yfinance',
        fetch_source: 'live',
        resolved_period: '1d',
      },
    })
    mockGetNewsFeed.mockResolvedValue({
      data: [
        {
          id: 7,
          title: 'Apple supplier update lifts near-term demand outlook',
          source: 'wire',
          published_at: '2026-03-28T08:30:00Z',
          symbols: ['AAPL'],
          categories: ['earnings'],
          markets: ['us'],
          sentiment: 0.32,
          importance: 4,
          llm_summary: 'supplier summary',
          llm_impact: 'supplier impact',
        },
      ],
      meta: {
        page: 1,
        page_size: 30,
        total: 7,
        sentiment_distribution: {
          positive: 4,
          neutral: 2,
          negative: 1,
        },
        source: 'persisted',
        stale: false,
        as_of: '2026-03-28T08:30:00Z',
      },
    })
    mockGetEventHistory.mockResolvedValue({ data: [], meta: {} })
    mockGetFinancials.mockResolvedValue({ data: [], meta: {} })
    mockGetMargin.mockResolvedValue({ data: [], meta: {} })
    mockGetBigOrderFlow.mockResolvedValue({ data: [], meta: {} })
    mockGetDragonTiger.mockResolvedValue({ data: [], meta: {} })
    mockGetNorthbound.mockResolvedValue({ data: [], meta: {} })
    mockSyncHistory.mockResolvedValue({
      data: {
        symbol: 'AAPL',
        asset_type: 'stock',
        rows_synced: 42,
        requested_start: '2023-03-28',
        requested_end: '2026-03-28',
        local_rows: 200,
        local_start: '2023-03-28',
        local_end: '2026-03-28',
      },
      meta: { source: 'live', stale: false, as_of: '2026-03-28T09:31:00Z' },
    })
    mockAddWatchlistItem.mockResolvedValue({ data: null, meta: { created: true } })
  })

  it('shows history coverage and triggers sync from the quick context rail', async () => {
    renderPage()

    expect(await screen.findByText('History Coverage')).toBeInTheDocument()
    expect(screen.getByText('Kline')).toBeInTheDocument()
    expect(screen.queryByText(/live kline/i)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Sync 3Y' }))

    await waitFor(() => {
      expect(mockSyncHistory).toHaveBeenCalledWith('AAPL', expect.any(String), expect.any(String))
    })
    expect(await screen.findByText(/synced 42 rows/i)).toBeInTheDocument()
  })

  it('requests a 30-day symbol news window and renders the distribution block with importance stars', async () => {
    renderPage()

    await waitFor(() => {
      expect(mockGetNewsFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          symbols: 'AAPL',
          page_size: 30,
          start: expect.any(String),
          end: expect.any(String),
        }),
      )
    })

    expect(await screen.findByText('30D Sentiment Distribution')).toBeInTheDocument()
    expect(screen.getByText('coverage 30D')).toBeInTheDocument()
    expect(screen.getByText(/current 30D symbol-linked news window/i)).toBeInTheDocument()
    expect(screen.queryByText(/live symbol-linked news window/i)).toBeNull()
    expect(screen.getAllByLabelText('importance 4 of 5').length).toBeGreaterThan(0)
  })

  it('keeps polling the symbol summary and chart while the page stays open', async () => {
    renderPage()

    await waitFor(() => {
      expect(mockGetMarketSummary).toHaveBeenCalledTimes(1)
      expect(mockGetKline).toHaveBeenCalledTimes(1)
      expect(mockGetNewsFeed).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(mockGetMarketSummary.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(mockGetNewsFeed).toHaveBeenCalledTimes(1)
      expect(mockGetKline.mock.calls.length).toBeGreaterThanOrEqual(2)
    }, { timeout: 1000 })
  })
})
