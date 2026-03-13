import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBacktestWorkspace } from './useBacktestWorkspace'

const mockRunBacktest = vi.fn()
const mockDownloadFile = vi.fn()

vi.mock('../api/backtest', () => ({
  runBacktest: (...args: unknown[]) => mockRunBacktest(...args),
}))

vi.mock('../utils/download', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}))

describe('useBacktestWorkspace', () => {
  const baseArgs = {
    selectedAsset: { symbol: 'AAPL', name: 'Apple Inc.', asset_type: 'stock' as const, market: 'US' },
    strategyName: 'ma_cross' as const,
    fast: 5,
    slow: 20,
    rsiPeriod: 14,
    oversold: 30,
    overbought: 70,
    initialCapital: 100000,
    backtestStartDate: '2025-01-01',
    backtestEndDate: '2026-01-01',
    syncIfMissing: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects invalid date ranges before calling the API', async () => {
    const { result } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        backtestStartDate: '2026-01-02',
        backtestEndDate: '2026-01-01',
      }),
    )

    await act(async () => {
      await result.current.runBacktestNow()
    })

    expect(mockRunBacktest).not.toHaveBeenCalled()
    expect(result.current.backtestError).toBe('回测开始日期必须早于结束日期')
  })

  it('stores successful backtest results and supports clearing them', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [{ date: '2026-01-01', value: 100000 }], trades: [], metrics: { total_return: 12.3 } },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result } = renderHook(() => useBacktestWorkspace(baseArgs))

    await act(async () => {
      await result.current.runBacktestNow()
    })

    expect(result.current.backtestResult?.metrics.total_return).toBe(12.3)

    act(() => {
      result.current.clearBacktestState()
    })

    expect(result.current.backtestResult).toBeNull()
    expect(result.current.backtestMeta).toBeNull()
    expect(result.current.backtestError).toBeNull()
  })

  it('exports watchable payloads through download helpers', async () => {
    mockRunBacktest.mockResolvedValue({
      data: {
        equity_curve: [{ date: '2026-01-01', value: 100000 }],
        trades: [{ date: '2026-01-01', symbol: 'AAPL', action: 'buy', price: 100, shares: 1, commission: 0, pnl: 0 }],
        metrics: { total_return: 12.3 },
      },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result } = renderHook(() => useBacktestWorkspace(baseArgs))

    await act(async () => {
      await result.current.runBacktestNow()
    })

    act(() => {
      result.current.exportBacktestJson()
      result.current.exportEquityCurveCsv()
      result.current.exportTradesCsv()
    })

    expect(mockDownloadFile).toHaveBeenCalledTimes(3)
    expect(mockDownloadFile.mock.calls[0][0]).toBe('AAPL_backtest.json')
    expect(mockDownloadFile.mock.calls[1][0]).toBe('AAPL_equity_curve.csv')
    expect(mockDownloadFile.mock.calls[2][0]).toBe('AAPL_trades.csv')
  })
})
