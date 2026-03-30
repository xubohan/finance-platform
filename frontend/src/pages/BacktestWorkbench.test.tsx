import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import BacktestWorkbenchPage from './BacktestWorkbench'

const mockCompareBacktestStrategies = vi.fn()
const mockGetBacktestTask = vi.fn()
const mockGetBacktestStrategies = vi.fn()
const mockRunBacktest = vi.fn()

vi.mock('../api/backtest', () => ({
  compareBacktestStrategies: (...args: unknown[]) => mockCompareBacktestStrategies(...args),
  extractBacktestTaskId: (response?: { data?: Record<string, unknown>; meta?: Record<string, unknown> } | null) =>
    response?.data?.task_id ?? response?.data?.taskId ?? response?.meta?.task_id ?? response?.meta?.taskId ?? null,
  getBacktestTask: (...args: unknown[]) => mockGetBacktestTask(...args),
  getBacktestStrategies: (...args: unknown[]) => mockGetBacktestStrategies(...args),
  runBacktest: (...args: unknown[]) => mockRunBacktest(...args),
}))

vi.mock('../components/backtest/EquityCurve', () => ({
  default: ({ series, points }: { series?: Array<{ id: string }>; points?: Array<{ date: string; value: number }> }) => (
    <div data-testid="equity-curve" data-series-count={series?.length ?? (points?.length ? 1 : 0)} />
  ),
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
      <MemoryRouter initialEntries={['/backtest']}>
        <BacktestWorkbenchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BacktestWorkbenchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockGetBacktestTask.mockResolvedValue({ data: null, meta: {} })
    mockRunBacktest.mockResolvedValue({
      data: {
        equity_curve: [{ date: '2024-01-01', value: 100 }],
        benchmark_curve: [{ date: '2024-01-01', value: 100 }],
        trades: [],
        metrics: {},
      },
      meta: { storage_source: 'live', source: 'live', coverage_complete: true },
    })
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        {
          strategy_name: 'bollinger_reversion',
          label: 'Bollinger Reversion',
          total_return: 12,
          annual_return: 5,
          sharpe_ratio: 1.1,
          max_drawdown: -4,
          win_rate: 58,
          trade_count: 6,
        },
      ],
      curves: [
        {
          strategy_name: 'bollinger_reversion',
          label: 'Bollinger Reversion',
          points: [{ date: '2024-01-01', value: 112 }],
        },
      ],
      meta: { count: 1, storage_source: 'live', source: 'live', as_of: '2026-03-26T00:00:00Z' },
    })
    mockGetBacktestStrategies.mockResolvedValue({
      data: [
        { name: 'ema_cross', label: 'EMA Cross', parameter_mode: 'fast_slow', summary: '' },
        { name: 'bollinger_reversion', label: 'Bollinger Reversion', parameter_mode: 'special', summary: '' },
        { name: 'donchian_breakout', label: 'Donchian Breakout', parameter_mode: 'special', summary: '' },
        { name: 'adx_trend', label: 'ADX Trend', parameter_mode: 'threshold', summary: '' },
        { name: 'supertrend_follow', label: 'Supertrend Follow', parameter_mode: 'period_multiplier', summary: '' },
        { name: 'buy_hold', label: 'Buy And Hold', parameter_mode: 'none', summary: '' },
      ],
      meta: { count: 6 },
    })
  })

  it('compares the current strategy together with pool strategies and builds per-strategy parameters', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Compare Pool' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Bollinger Reversion' })).toBeInTheDocument()
    })

    await userEvent.selectOptions(screen.getAllByRole('combobox')[1], 'Bollinger Reversion')
    await userEvent.clear(screen.getByPlaceholderText('Band Period'))
    await userEvent.type(screen.getByPlaceholderText('Band Period'), '21')
    await userEvent.clear(screen.getByPlaceholderText('Std Dev'))
    await userEvent.type(screen.getByPlaceholderText('Std Dev'), '2.5')

    await userEvent.click(screen.getByRole('button', { name: '仅当前' }))
    await userEvent.click(screen.getByRole('button', { name: 'Donchian Breakout' }))
    await userEvent.click(screen.getByRole('button', { name: 'ADX Trend' }))
    await userEvent.click(screen.getByRole('button', { name: 'Buy And Hold' }))
    await userEvent.click(screen.getByRole('button', { name: 'Compare Pool' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy_names: ['bollinger_reversion', 'donchian_breakout', 'adx_trend', 'buy_hold'],
          parameters_by_strategy: {
            bollinger_reversion: { period: 21, stddev: 2.5 },
            donchian_breakout: { lookback: 10, exit_lookback: 30 },
            adx_trend: { period: 21, threshold: 20 },
          },
        }),
        { asyncMode: true },
      )
    })
  })

  it('restores multiplier and capital from compare snapshot history before rerunning compare', async () => {
    window.localStorage.setItem(
      'market-workspace:compare-snapshots',
      JSON.stringify([
        {
          symbol: 'BTC',
          assetType: 'crypto',
          strategyName: 'supertrend_follow',
          compareStrategyNames: ['supertrend_follow', 'buy_hold'],
          compareRankingMetric: 'sharpe_ratio',
          fast: 10,
          slow: 30,
          rsiPeriod: 14,
          oversold: 2.5,
          overbought: 70,
          multiplier: 2.5,
          initialCapital: 250000,
          backtestStartDate: '2024-01-01',
          backtestEndDate: '2025-01-01',
          syncIfMissing: false,
          bestStrategyName: 'buy_hold',
          bestStrategyLabel: 'Buy And Hold',
          currentRank: 2,
          storageSource: 'local',
          asOf: '2026-03-26T00:00:00Z',
          createdAt: '2026-03-26T01:00:00Z',
        },
      ]),
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('BTC')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('BTC'))

    await waitFor(() => {
      expect(screen.getByDisplayValue('250000')).toBeInTheDocument()
      expect(screen.getByDisplayValue('2.5')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Compare Pool' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: 'BTC',
          asset_type: 'crypto',
          initial_capital: 250000,
          sync_if_missing: false,
          strategy_names: ['supertrend_follow', 'buy_hold'],
          parameters_by_strategy: {
            supertrend_follow: { period: 14, multiplier: 2.5 },
          },
        }),
        { asyncMode: true },
      )
    })
  })

  it('fills run detail and result canvas from completed async task payloads', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { status: 'queued', task_kind: 'run' },
      meta: { task_id: 'bt-run-1', execution_mode: 'celery', accepted_at: '2026-03-28T00:00:00Z' },
    })
    mockCompareBacktestStrategies.mockResolvedValue({
      data: { status: 'queued', task_id: 'bt-compare-1', task_kind: 'compare' },
      curves: [],
      meta: { execution_mode: 'celery', accepted_at: '2026-03-28T00:00:01Z' },
    })
    mockGetBacktestTask.mockImplementation(async (taskId: string) => {
      if (taskId === 'bt-run-1') {
        return {
          data: {
            task_id: 'bt-run-1',
            status: 'completed',
            task_kind: 'run',
            result_payload: {
              data: {
                equity_curve: [{ date: '2024-01-01', value: 100 }],
                benchmark_curve: [{ date: '2024-01-01', value: 101 }],
                trades: [{ date: '2024-01-03', symbol: 'AAPL', action: 'BUY', price: 100, shares: 10, commission: 1, pnl: 0 }],
                metrics: { total_return: 0.12, sharpe_ratio: 1.4 },
              },
              meta: { source: 'live', storage_source: 'live', stale: false, as_of: '2026-03-28T00:00:00Z' },
            },
          },
          meta: { execution_mode: 'celery' },
        }
      }
      if (taskId === 'bt-compare-1') {
        return {
          data: {
            task_id: 'bt-compare-1',
            status: 'completed',
            task_kind: 'compare',
            result_payload: {
              data: [
                {
                  strategy_name: 'bollinger_reversion',
                  label: 'Bollinger Reversion',
                  total_return: 12,
                  annual_return: 5,
                  sharpe_ratio: 1.1,
                  max_drawdown: -4,
                  win_rate: 58,
                  trade_count: 6,
                },
              ],
              curves: [
                {
                  strategy_name: 'bollinger_reversion',
                  label: 'Bollinger Reversion',
                  points: [{ date: '2024-01-01', value: 112 }],
                },
              ],
              meta: { count: 1, source: 'live', storage_source: 'live', as_of: '2026-03-28T00:00:01Z' },
            },
          },
          meta: { execution_mode: 'celery' },
        }
      }
      return { data: null, meta: {} }
    })

    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Run Backtest' }))

    await waitFor(() => {
      expect(mockRunBacktest).toHaveBeenCalledWith(expect.any(Object), { asyncMode: true })
      expect(mockGetBacktestTask).toHaveBeenCalledWith('bt-run-1')
      expect(screen.getByText('Portfolio')).toBeInTheDocument()
      expect(screen.getByText('Benchmark')).toBeInTheDocument()
      expect(screen.getByText('source live')).toBeInTheDocument()
      expect(screen.getByText('2024-01-03')).toBeInTheDocument()
      expect(screen.getAllByTestId('equity-curve')[0]).toHaveAttribute('data-series-count', '2')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Compare Pool' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenCalledWith(expect.any(Object), { asyncMode: true })
      expect(mockGetBacktestTask).toHaveBeenCalledWith('bt-compare-1')
      expect(screen.getAllByText('Bollinger Reversion').length).toBeGreaterThan(0)
      expect(screen.getAllByTestId('equity-curve')).toHaveLength(3)
      expect(screen.getAllByTestId('equity-curve')[2]).toHaveAttribute('data-series-count', '1')
    })
  })

  it('hides stale result canvas content and locks actions while a new task is still queued', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Run Backtest' }))

    await waitFor(() => {
      expect(screen.getByText('Portfolio')).toBeInTheDocument()
    })

    mockRunBacktest.mockResolvedValue({
      data: { status: 'queued', task_id: 'bt-run-queued', task_kind: 'run' },
      meta: { execution_mode: 'celery', accepted_at: '2026-03-28T00:10:00Z' },
    })
    mockGetBacktestTask.mockResolvedValue({
      data: { task_id: 'bt-run-queued', status: 'running', task_kind: 'run' },
      meta: { execution_mode: 'celery' },
    })

    await userEvent.click(screen.getByRole('button', { name: 'Run Backtest' }))

    await waitFor(() => {
      expect(mockGetBacktestTask).toHaveBeenCalledWith('bt-run-queued')
      expect(screen.getByText(/The current backtest task is running/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Running' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Compare Pool' })).toBeDisabled()
    })
  })

  it('keeps a single result empty state and exposes layout roles before any run happens', async () => {
    renderPage()

    expect(document.querySelector('[data-page="backtest-workbench"]')).not.toBeNull()
    expect(document.querySelector('[data-layout-role="primary"]')).not.toBeNull()
    expect(document.querySelector('[data-layout-role="secondary"]')).not.toBeNull()
    expect(document.querySelector('[data-layout-role="tertiary"]')).not.toBeNull()
    expect(screen.getByText(/Run a backtest or compare pool to populate the result canvas/i)).toBeInTheDocument()
    expect(screen.queryByText(/Run Compare Pool to overlay strategy equity curves/i)).toBeNull()
  })
})
