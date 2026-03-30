import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ScreenerPage from './ScreenerHub'

const mockRunBacktestLab = vi.fn()
const mockGetBacktestTask = vi.fn()
const mockGetKline = vi.fn()
const mockRunScreener = vi.fn()
const mockGetScreenerSymbols = vi.fn()
const mockAddWatchlistItem = vi.fn()

vi.mock('../api/backtest', () => ({
  extractBacktestTaskId: (response?: { data?: Record<string, unknown>; meta?: Record<string, unknown> } | null) =>
    response?.data?.task_id ?? response?.data?.taskId ?? response?.meta?.task_id ?? response?.meta?.taskId ?? null,
  getBacktestTask: (...args: unknown[]) => mockGetBacktestTask(...args),
  runBacktestLab: (...args: unknown[]) => mockRunBacktestLab(...args),
}))

vi.mock('../api/market', () => ({
  getKline: (...args: unknown[]) => mockGetKline(...args),
  toCandles: (rows: Array<Record<string, number | string>>) => rows,
}))

vi.mock('../api/screener', () => ({
  getScreenerSymbols: (...args: unknown[]) => mockGetScreenerSymbols(...args),
  runScreener: (...args: unknown[]) => mockRunScreener(...args),
}))

vi.mock('../api/watchlist', () => ({
  addWatchlistItem: (...args: unknown[]) => mockAddWatchlistItem(...args),
}))

vi.mock('../components/chart/KlineChart', () => ({
  default: () => <div data-testid="kline-chart" />,
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
      <MemoryRouter initialEntries={['/screener']}>
        <ScreenerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ScreenerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBacktestTask.mockResolvedValue({ data: null, meta: {} })
    mockGetScreenerSymbols.mockResolvedValue({
      data: [{ symbol: 'AAPL', name: 'Apple', market: 'us' }],
      meta: { count: 1, total_available: 50, source: 'live', stale: false, as_of: '2026-03-26T00:00:00Z' },
    })
    mockRunScreener.mockResolvedValue({
      data: [],
      meta: { source: 'live', stale: false, as_of: '2026-03-26T00:00:00Z' },
    })
    mockRunBacktestLab.mockResolvedValue({ data: [], meta: { source: 'live', stale: false, as_of: '2026-03-26T00:00:00Z' } })
    mockGetKline.mockResolvedValue({ data: [], meta: {} })
    mockAddWatchlistItem.mockResolvedValue({ data: null, meta: { created: true } })
  })

  it('starts with the action drawer collapsed so shortlist stays primary', async () => {
    renderPage()

    expect(document.querySelector('[data-page="screener-hub"]')).not.toBeNull()
    expect(document.querySelector('[data-layout-role="primary"]')).not.toBeNull()
    expect(document.querySelector('[data-layout-role="secondary"]')).not.toBeNull()
    expect(await screen.findByText('Drawer is collapsed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Expand/i })).toBeInTheDocument()
  })

  it('shows the live universe snapshot and labels market cap bounds as a local page filter', async () => {
    renderPage()

    await waitFor(() => {
      expect(mockGetScreenerSymbols).toHaveBeenCalledWith({ market: 'us', limit: 12 })
    })

    expect(await screen.findByText(/This is the live symbol universe returned by/i)).toBeInTheDocument()
    expect(screen.getByText(/Market cap bounds are applied only as a post-filter/i)).toBeInTheDocument()
    expect(screen.getAllByText(/AAPL/i).length).toBeGreaterThan(0)
  })

  it('passes page params to screener API and can move to next page', async () => {
    mockRunScreener
      .mockResolvedValueOnce({
        data: [],
        meta: { source: 'live', stale: false, as_of: '2026-03-26T00:00:00Z', page: 1, total_pages: 2, total_items: 80 },
      })
      .mockResolvedValueOnce({
        data: [],
        meta: { source: 'live', stale: false, as_of: '2026-03-26T00:01:00Z', page: 2, total_pages: 2, total_items: 80 },
      })

    renderPage()

    await waitFor(() => {
      expect(mockRunScreener).toHaveBeenCalledWith(expect.objectContaining({ page: 1, page_size: 50 }))
    })

    await userEvent.click(await screen.findByRole('button', { name: 'next' }))

    await waitFor(() => {
      expect(mockRunScreener).toHaveBeenCalledWith(expect.objectContaining({ page: 2, page_size: 50 }))
    })
  })

  it('tracks async batch backtest tasks and fills the snapshot from completed lab payloads', async () => {
    mockRunScreener.mockResolvedValue({
      data: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          pe_ttm: 22,
          roe: 18,
          profit_yoy: 12,
          market_cap: 3000000000000,
          market: 'us',
        },
      ],
      meta: { source: 'live', stale: false, as_of: '2026-03-26T00:00:00Z', page: 1, total_pages: 1, total_items: 1 },
    })
    mockRunBacktestLab.mockResolvedValue({
      data: { status: 'queued', task_kind: 'lab' },
      meta: { task_id: 'bt-lab-1', execution_mode: 'celery', accepted_at: '2026-03-28T00:00:00Z' },
    })
    mockGetBacktestTask.mockResolvedValue({
      data: {
        task_id: 'bt-lab-1',
        status: 'completed',
        task_kind: 'lab',
        result_payload: {
          data: [
            {
              symbol: 'AAPL',
              name: 'Apple',
              market: 'us',
              total_return: 0.18,
              annual_return: 0.11,
              sharpe_ratio: 1.3,
              max_drawdown: -0.09,
              win_rate: 0.58,
              trade_count: 9,
            },
          ],
          meta: { source: 'live', stale: false, as_of: '2026-03-28T00:00:00Z', market: 'us', count: 1 },
        },
      },
      meta: { execution_mode: 'celery' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('AAPL')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /Expand/i }))
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Run batch backtest' }))

    await waitFor(() => {
      expect(mockRunBacktestLab).toHaveBeenCalledWith(
        expect.objectContaining({
          market: 'us',
          symbols: ['AAPL'],
        }),
        { asyncMode: true },
      )
      expect(mockGetBacktestTask).toHaveBeenCalledWith('bt-lab-1')
      expect(screen.getByText('task_id bt-lab-1')).toBeInTheDocument()
      expect(screen.getByText('completed')).toBeInTheDocument()
      expect(screen.getAllByText('Apple').length).toBeGreaterThan(0)
      expect(screen.getByText('9 trades')).toBeInTheDocument()
    })
  })
})
