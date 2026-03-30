import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AppShell from './AppShell'

const mockGetDataStatus = vi.fn()
const mockGetHealth = vi.fn()
const mockSearchAssets = vi.fn()

vi.mock('../../api/system', () => ({
  getDataStatus: (...args: unknown[]) => mockGetDataStatus(...args),
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}))

vi.mock('../../api/market', () => ({
  searchAssets: (...args: unknown[]) => mockSearchAssets(...args),
}))

vi.mock('../../lib/query-refresh', () => ({
  BACKGROUND_REFRESH_QUERY_OPTIONS: {
    refetchIntervalInBackground: true,
  },
  QUERY_REFRESH_MS: {
    shellRuntime: 100,
  },
}))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/events']}>
        <Routes>
          <Route
            path="*"
            element={
              <AppShell>
                <LocationProbe />
              </AppShell>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetHealth.mockResolvedValue({ status: 'ok' })
    mockSearchAssets.mockResolvedValue({ data: [], meta: { count: 0 } })
    mockGetDataStatus.mockResolvedValue({
      data: {
        provider_health: {
          checks: [
            { name: 'stock_snapshot_us', status: 'ok', details: { source: 'polygon', stale: false } },
            { name: 'crypto_quote', status: 'degraded', details: { source: 'coingecko', stale: true } },
            { name: 'macro_calendar', status: 'error', details: { source: 'fmp', stale: true } },
          ],
          summary: { status: 'ok' },
        },
        stock_quote_aapl: {
          symbol: 'AAPL',
          provider: 'tencent',
          source: 'live',
          stale: false,
        },
        crypto_quote_btc: {
          symbol: 'BTC',
          provider: 'binance',
          source: 'live',
          stale: false,
        },
      },
      meta: { generated_at: '2026-03-26T00:00:00Z', served_from_cache: false, cache_ttl_sec: 15 },
    })
  })

  it('formats provider status into a readable label without raw underscore tokens', async () => {
    renderShell()

    expect((await screen.findAllByText(/stock snapshot us/i)).length).toBeGreaterThan(0)
    expect(screen.queryByText('stock_snapshot_us:ok')).toBeNull()
    expect(screen.getAllByText(/degraded 1 · error 1/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/sources:\s*polygon,\s*coingecko,\s*fmp/i)).toBeInTheDocument()
    expect(screen.getByText(/stock sample:\s*AAPL\s*·\s*tencent\s*·\s*stale false/i)).toBeInTheDocument()
    expect(screen.getByText(/crypto sample:\s*BTC\s*·\s*binance\s*·\s*stale false/i)).toBeInTheDocument()
    expect(screen.getByText(/cache:\s*fresh\s*·\s*ttl 15s/i)).toBeInTheDocument()
  })

  it('surfaces request failure instead of silently collapsing all runtime errors into unknown', async () => {
    mockGetHealth.mockRejectedValue(new Error('boom'))
    mockGetDataStatus.mockRejectedValue(new Error('boom'))

    renderShell()

    expect((await screen.findAllByText(/request failed/i)).length).toBeGreaterThan(0)
  })

  it('uses live asset search results instead of always blind-jumping the typed symbol', async () => {
    mockSearchAssets.mockResolvedValue({
      data: [
        { symbol: 'AAPL', name: 'Apple Inc.', asset_type: 'stock', market: 'us' },
      ],
      meta: { count: 1 },
    })

    renderShell()

    await userEvent.type(screen.getByPlaceholderText(/AAPL \/ Apple/i), 'Apple')

    await waitFor(() => {
      expect(mockSearchAssets).toHaveBeenCalledWith('Apple', 'all', 8)
    })

    await userEvent.click(screen.getByRole('button', { name: /AAPL Apple Inc\./i }))

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/market/AAPL')
    })
  })

  it('polls runtime status while the shell stays open', async () => {
    renderShell()

    await waitFor(() => {
      expect(mockGetHealth).toHaveBeenCalledTimes(1)
      expect(mockGetDataStatus).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(mockGetHealth.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(mockGetDataStatus.mock.calls.length).toBeGreaterThanOrEqual(2)
    }, { timeout: 1000 })
  })
})
