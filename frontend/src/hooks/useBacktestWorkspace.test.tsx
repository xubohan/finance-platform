import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBacktestWorkspace } from './useBacktestWorkspace'

const mockRunBacktest = vi.fn()
const mockCompareBacktestStrategies = vi.fn()
const mockDownloadFile = vi.fn()

vi.mock('../api/backtest', () => ({
  runBacktest: (...args: unknown[]) => mockRunBacktest(...args),
  compareBacktestStrategies: (...args: unknown[]) => mockCompareBacktestStrategies(...args),
}))

vi.mock('../utils/download', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}))

describe('useBacktestWorkspace', () => {
  const baseArgs = {
    selectedAsset: { symbol: 'AAPL', name: 'Apple Inc.', asset_type: 'stock' as const, market: 'US' },
    strategyName: 'ma_cross' as const,
    compareStrategyNames: ['buy_hold', 'ma_cross', 'ema_cross', 'macd_signal', 'rsi_reversal'] as const,
    compareRankingMetric: 'total_return' as const,
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

  it('marks backtest results as stale after parameters change', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [{ date: '2026-01-01', value: 100000 }], trades: [], metrics: { total_return: 12.3 } },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result, rerender } = renderHook((props) => useBacktestWorkspace(props), {
      initialProps: baseArgs,
    })

    await act(async () => {
      await result.current.runBacktestNow()
    })

    expect(result.current.isBacktestStale).toBe(false)

    rerender({
      ...baseArgs,
      fast: 8,
    })

    expect(result.current.isBacktestStale).toBe(true)
  })

  it('runs strategy compare against the core strategy pool', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: -6, win_rate: 55, trade_count: 8 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 10, annual_return: 4, sharpe_ratio: 0.9, max_drawdown: -8, win_rate: 0, trade_count: 0 },
      ],
      meta: { count: 2, ranking_metric: 'total_return' },
    })

    const { result } = renderHook(() => useBacktestWorkspace(baseArgs))

    await act(async () => {
      await result.current.runStrategyCompare()
    })

    expect(mockCompareBacktestStrategies).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'AAPL',
        asset_type: 'stock',
        strategy_names: ['ma_cross', 'buy_hold', 'ema_cross', 'macd_signal', 'rsi_reversal'],
        ranking_metric: 'total_return',
        parameters_by_strategy: {
          ma_cross: { fast: 5, slow: 20 },
          ema_cross: { fast: 5, slow: 20 },
          rsi_reversal: { period: 14, oversold: 30, overbought: 70 },
        },
      }),
    )
    expect(result.current.compareRows).toHaveLength(2)
    expect(result.current.compareRows[0]?.strategy_name).toBe('ma_cross')
  })

  it('exports strategy compare rows through download helpers', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: -6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 1, ranking_metric: 'total_return' },
    })

    const { result } = renderHook(() => useBacktestWorkspace(baseArgs))

    await act(async () => {
      await result.current.runStrategyCompare()
    })

    act(() => {
      result.current.exportCompareCsv()
    })

    expect(mockDownloadFile).toHaveBeenCalledWith(
      'AAPL_strategy_compare.csv',
      expect.stringContaining('strategy_name,label,total_return'),
      'text/csv;charset=utf-8',
    )
  })

  it('exports strategy compare payloads through download helpers', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: -6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 1, ranking_metric: 'total_return', storage_source: 'local' },
    })

    const { result } = renderHook(() => useBacktestWorkspace(baseArgs))

    await act(async () => {
      await result.current.runStrategyCompare()
    })

    act(() => {
      result.current.exportCompareJson()
    })

    expect(mockDownloadFile).toHaveBeenCalledWith(
      'AAPL_strategy_compare.json',
      expect.stringContaining('"compareRankingMetric": "total_return"'),
      'application/json;charset=utf-8',
    )
  })

  it('reorders compare rows when ranking metric changes', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 0.8, max_drawdown: 9, win_rate: 55, trade_count: 8 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 10, annual_return: 4, sharpe_ratio: 1.4, max_drawdown: 4, win_rate: 60, trade_count: 2 },
      ],
      meta: { count: 2, ranking_metric: 'total_return' },
    })

    const { result, rerender } = renderHook((props) => useBacktestWorkspace(props), {
      initialProps: baseArgs,
    })

    await act(async () => {
      await result.current.runStrategyCompare()
    })

    expect(result.current.compareRows.map((item) => item.strategy_name)).toEqual(['ma_cross', 'buy_hold'])

    rerender({
      ...baseArgs,
      compareRankingMetric: 'sharpe_ratio',
    })

    expect(result.current.compareRows.map((item) => item.strategy_name)).toEqual(['buy_hold', 'ma_cross'])
    expect(result.current.isCompareStale).toBe(false)
  })

  it('marks compare results as stale after compare pool changes', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: -6, win_rate: 55, trade_count: 8 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 10, annual_return: 4, sharpe_ratio: 0.9, max_drawdown: -8, win_rate: 0, trade_count: 0 },
      ],
      meta: { count: 2, ranking_metric: 'total_return' },
    })

    const { result, rerender } = renderHook((props) => useBacktestWorkspace(props), {
      initialProps: baseArgs,
    })

    await act(async () => {
      await result.current.runStrategyCompare()
    })

    expect(result.current.isCompareStale).toBe(false)

    rerender({
      ...baseArgs,
      compareStrategyNames: ['buy_hold', 'ema_cross'],
    })

    expect(result.current.isCompareStale).toBe(true)
  })

  it('builds compare parameters for multiple strategy modes in the compare pool', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [],
      meta: { count: 0, ranking_metric: 'total_return' },
    })

    const { result } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'bollinger_reversion',
        compareStrategyNames: ['donchian_breakout', 'adx_trend', 'buy_hold'],
        rsiPeriod: 21,
        oversold: 2.5,
        slow: 11,
        fast: 22,
      }),
    )

    await act(async () => {
      await result.current.runStrategyCompare()
    })

    expect(mockCompareBacktestStrategies).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy_names: ['bollinger_reversion', 'donchian_breakout', 'adx_trend', 'buy_hold'],
        parameters_by_strategy: {
          bollinger_reversion: { period: 21, stddev: 2.5 },
          donchian_breakout: { lookback: 22, exit_lookback: 11 },
          adx_trend: { period: 21, threshold: 2.5 },
        },
      }),
    )
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

  it('maps bollinger and donchian strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: bollingerResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'bollinger_reversion',
        rsiPeriod: 21,
        oversold: 2.5,
      }),
    )

    await act(async () => {
      await bollingerResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'bollinger_reversion',
      parameters: { period: 21, stddev: 2.5 },
    })

    const { result: donchianResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'donchian_breakout',
        fast: 22,
        slow: 11,
      }),
    )

    await act(async () => {
      await donchianResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'donchian_breakout',
      parameters: { lookback: 22, exit_lookback: 11 },
    })
  })

  it('maps ema and oscillator strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: emaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'ema_cross',
        fast: 8,
        slow: 21,
      }),
    )

    await act(async () => {
      await emaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'ema_cross',
      parameters: { fast: 8, slow: 21 },
    })

    const { result: temaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'tema_cross',
        fast: 5,
        slow: 20,
      }),
    )

    await act(async () => {
      await temaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'tema_cross',
      parameters: { fast: 5, slow: 20 },
    })

    const { result: wmaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'wma_cross',
        fast: 5,
        slow: 20,
      }),
    )

    await act(async () => {
      await wmaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[2][0]).toMatchObject({
      strategy_name: 'wma_cross',
      parameters: { fast: 5, slow: 20 },
    })

    const { result: hmaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'hma_cross',
        fast: 9,
        slow: 21,
      }),
    )

    await act(async () => {
      await hmaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[3][0]).toMatchObject({
      strategy_name: 'hma_cross',
      parameters: { fast: 9, slow: 21 },
    })

    const { result: stochasticResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'stochastic_reversal',
        rsiPeriod: 14,
        oversold: 20,
        overbought: 80,
      }),
    )

    await act(async () => {
      await stochasticResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[4][0]).toMatchObject({
      strategy_name: 'stochastic_reversal',
      parameters: { period: 14, oversold: 20, overbought: 80 },
    })

    const { result: uoResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'ultimate_oscillator_reversal',
        rsiPeriod: 7,
        oversold: 30,
        overbought: 70,
      }),
    )

    await act(async () => {
      await uoResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[5][0]).toMatchObject({
      strategy_name: 'ultimate_oscillator_reversal',
      parameters: { period: 7, oversold: 30, overbought: 70 },
    })

    const { result: stochRsiResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'stochrsi_reversal',
        rsiPeriod: 14,
        oversold: 20,
        overbought: 80,
      }),
    )

    await act(async () => {
      await stochRsiResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[6][0]).toMatchObject({
      strategy_name: 'stochrsi_reversal',
      parameters: { period: 14, oversold: 20, overbought: 80 },
    })

    const { result: mfiResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'mfi_reversal',
        rsiPeriod: 14,
        oversold: 20,
        overbought: 80,
      }),
    )

    await act(async () => {
      await mfiResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[7][0]).toMatchObject({
      strategy_name: 'mfi_reversal',
      parameters: { period: 14, oversold: 20, overbought: 80 },
    })

    const { result: cmoResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'cmo_reversal',
        rsiPeriod: 14,
        oversold: -50,
        overbought: 50,
      }),
    )

    await act(async () => {
      await cmoResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[8][0]).toMatchObject({
      strategy_name: 'cmo_reversal',
      parameters: { period: 14, oversold: -50, overbought: 50 },
    })

    const { result: dpoResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'dpo_reversal',
        rsiPeriod: 20,
        oversold: -2,
        overbought: 2,
      }),
    )

    await act(async () => {
      await dpoResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[9][0]).toMatchObject({
      strategy_name: 'dpo_reversal',
      parameters: { period: 20, oversold: -2, overbought: 2 },
    })

    const { result: williamsResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'williams_reversal',
        rsiPeriod: 14,
        oversold: -80,
        overbought: -20,
      }),
    )

    await act(async () => {
      await williamsResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[10][0]).toMatchObject({
      strategy_name: 'williams_reversal',
      parameters: { period: 14, oversold: -80, overbought: -20 },
    })

    const { result: fisherResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'fisher_reversal',
        rsiPeriod: 10,
        oversold: -1.5,
        overbought: 1.5,
      }),
    )

    await act(async () => {
      await fisherResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[11][0]).toMatchObject({
      strategy_name: 'fisher_reversal',
      parameters: { period: 10, oversold: -1.5, overbought: 1.5 },
    })
  })

  it('maps dema, zlema and schaff strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: demaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'dema_cross',
        fast: 5,
        slow: 20,
      }),
    )

    await act(async () => {
      await demaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'dema_cross',
      parameters: { fast: 5, slow: 20 },
    })

    const { result: zlemaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'zlema_cross',
        fast: 5,
        slow: 20,
      }),
    )

    await act(async () => {
      await zlemaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'zlema_cross',
      parameters: { fast: 5, slow: 20 },
    })

    const { result: schaffResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'schaff_reversal',
        rsiPeriod: 14,
        oversold: 25,
        overbought: 75,
      }),
    )

    await act(async () => {
      await schaffResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[2][0]).toMatchObject({
      strategy_name: 'schaff_reversal',
      parameters: { period: 14, oversold: 25, overbought: 75 },
    })
  })

  it('maps smma, vwma and awesome strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: smmaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'smma_cross',
        fast: 5,
        slow: 20,
      }),
    )

    await act(async () => {
      await smmaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'smma_cross',
      parameters: { fast: 5, slow: 20 },
    })

    const { result: vwmaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'vwma_cross',
        fast: 5,
        slow: 20,
      }),
    )

    await act(async () => {
      await vwmaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'vwma_cross',
      parameters: { fast: 5, slow: 20 },
    })

    const { result: awesomeResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'awesome_reversal',
        rsiPeriod: 14,
        oversold: -1,
        overbought: 1,
      }),
    )

    await act(async () => {
      await awesomeResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[2][0]).toMatchObject({
      strategy_name: 'awesome_reversal',
      parameters: { period: 14, oversold: -1, overbought: 1 },
    })
  })

  it('maps alma, trima and cfo strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: almaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'alma_cross',
        fast: 9,
        slow: 21,
      }),
    )

    await act(async () => {
      await almaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'alma_cross',
      parameters: { fast: 9, slow: 21 },
    })

    const { result: trimaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'trima_cross',
        fast: 5,
        slow: 20,
      }),
    )

    await act(async () => {
      await trimaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'trima_cross',
      parameters: { fast: 5, slow: 20 },
    })

    const { result: cfoResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'cfo_reversal',
        rsiPeriod: 14,
        oversold: -2,
        overbought: 2,
      }),
    )

    await act(async () => {
      await cfoResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[2][0]).toMatchObject({
      strategy_name: 'cfo_reversal',
      parameters: { period: 14, oversold: -2, overbought: 2 },
    })
  })

  it('maps lsma, demarker and rvi strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: lsmaResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'lsma_cross',
        fast: 9,
        slow: 21,
      }),
    )

    await act(async () => {
      await lsmaResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'lsma_cross',
      parameters: { fast: 9, slow: 21 },
    })

    const { result: demarkerResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'demarker_reversal',
        rsiPeriod: 14,
        oversold: 30,
        overbought: 70,
      }),
    )

    await act(async () => {
      await demarkerResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'demarker_reversal',
      parameters: { period: 14, oversold: 30, overbought: 70 },
    })

    const { result: rviResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'rvi_reversal',
        rsiPeriod: 10,
        oversold: -0.2,
        overbought: 0.2,
      }),
    )

    await act(async () => {
      await rviResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[2][0]).toMatchObject({
      strategy_name: 'rvi_reversal',
      parameters: { period: 10, oversold: -0.2, overbought: 0.2 },
    })
  })

  it('maps mcginley and smi strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: mcginleyResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'mcginley_cross',
        fast: 8,
        slow: 21,
      }),
    )

    await act(async () => {
      await mcginleyResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'mcginley_cross',
      parameters: { fast: 8, slow: 21 },
    })

    const { result: smiResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'smi_reversal',
        rsiPeriod: 14,
        oversold: -40,
        overbought: 40,
      }),
    )

    await act(async () => {
      await smiResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'smi_reversal',
      parameters: { period: 14, oversold: -40, overbought: 40 },
    })
  })

  it('maps t3 and bias strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: t3Result } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 't3_cross',
        fast: 5,
        slow: 20,
      }),
    )

    await act(async () => {
      await t3Result.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 't3_cross',
      parameters: { fast: 5, slow: 20 },
    })

    const { result: biasResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'bias_reversal',
        rsiPeriod: 14,
        oversold: -5,
        overbought: 5,
      }),
    )

    await act(async () => {
      await biasResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'bias_reversal',
      parameters: { period: 14, oversold: -5, overbought: 5 },
    })
  })

  it('maps supertrend, adx and threshold strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: supertrendResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'supertrend_follow',
        rsiPeriod: 10,
        oversold: 2,
      }),
    )

    await act(async () => {
      await supertrendResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'supertrend_follow',
      parameters: { period: 10, multiplier: 2 },
    })

    const { result: adxResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'adx_trend',
        rsiPeriod: 14,
        oversold: 25,
      }),
    )

    await act(async () => {
      await adxResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'adx_trend',
      parameters: { period: 14, threshold: 25 },
    })

    const { result: keltnerResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'keltner_reversion',
        rsiPeriod: 20,
        oversold: 1.5,
      }),
    )

    await act(async () => {
      await keltnerResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[2][0]).toMatchObject({
      strategy_name: 'keltner_reversion',
      parameters: { period: 20, multiplier: 1.5 },
    })

    const { result: cmfResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'chaikin_money_flow_trend',
        rsiPeriod: 20,
        oversold: 0.05,
      }),
    )

    await act(async () => {
      await cmfResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[3][0]).toMatchObject({
      strategy_name: 'chaikin_money_flow_trend',
      parameters: { period: 20, threshold: 0.05 },
    })

    const { result: aroonResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'aroon_trend',
        rsiPeriod: 25,
        oversold: 70,
      }),
    )

    await act(async () => {
      await aroonResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[4][0]).toMatchObject({
      strategy_name: 'aroon_trend',
      parameters: { period: 25, threshold: 70 },
    })

    const { result: rocResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'roc_breakout',
        rsiPeriod: 12,
        oversold: 5,
      }),
    )

    await act(async () => {
      await rocResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[5][0]).toMatchObject({
      strategy_name: 'roc_breakout',
      parameters: { period: 12, threshold: 5 },
    })

    const { result: trixResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'trix_trend',
        rsiPeriod: 15,
        oversold: 0.2,
      }),
    )

    await act(async () => {
      await trixResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[6][0]).toMatchObject({
      strategy_name: 'trix_trend',
      parameters: { period: 15, threshold: 0.2 },
    })

    const { result: tsiResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'tsi_trend',
        rsiPeriod: 13,
        oversold: 10,
      }),
    )

    await act(async () => {
      await tsiResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[7][0]).toMatchObject({
      strategy_name: 'tsi_trend',
      parameters: { period: 13, threshold: 10 },
    })

    const { result: coppockResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'coppock_trend',
        rsiPeriod: 14,
        oversold: 0.5,
      }),
    )

    await act(async () => {
      await coppockResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[8][0]).toMatchObject({
      strategy_name: 'coppock_trend',
      parameters: { period: 14, threshold: 0.5 },
    })
  })

  it('maps vortex strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'vortex_trend',
        rsiPeriod: 14,
        oversold: 0.1,
      }),
    )

    await act(async () => {
      await result.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'vortex_trend',
      parameters: { period: 14, threshold: 0.1 },
    })
  })

  it('maps kst strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'kst_trend',
        rsiPeriod: 10,
        oversold: 5,
      }),
    )

    await act(async () => {
      await result.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'kst_trend',
      parameters: { period: 10, threshold: 5 },
    })
  })

  it('maps efi strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'efi_trend',
        rsiPeriod: 13,
        oversold: 1000,
      }),
    )

    await act(async () => {
      await result.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'efi_trend',
      parameters: { period: 13, threshold: 1000 },
    })
  })

  it('maps vhf strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'vhf_trend',
        rsiPeriod: 14,
        oversold: 0.4,
      }),
    )

    await act(async () => {
      await result.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'vhf_trend',
      parameters: { period: 14, threshold: 0.4 },
    })
  })

  it('maps vzo and pmo strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: vzoResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'vzo_trend',
        rsiPeriod: 14,
        oversold: 15,
      }),
    )

    await act(async () => {
      await vzoResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'vzo_trend',
      parameters: { period: 14, threshold: 15 },
    })

    const { result: pmoResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'pmo_trend',
        rsiPeriod: 12,
        oversold: 0.5,
      }),
    )

    await act(async () => {
      await pmoResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'pmo_trend',
      parameters: { period: 12, threshold: 0.5 },
    })
  })

  it('maps chaikin volatility and linreg slope strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: chaikinVolResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'chaikin_volatility_trend',
        rsiPeriod: 10,
        oversold: 10,
      }),
    )

    await act(async () => {
      await chaikinVolResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'chaikin_volatility_trend',
      parameters: { period: 10, threshold: 10 },
    })

    const { result: linRegResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'linreg_slope_trend',
        rsiPeriod: 14,
        oversold: 0.3,
      }),
    )

    await act(async () => {
      await linRegResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'linreg_slope_trend',
      parameters: { period: 14, threshold: 0.3 },
    })
  })

  it('maps vwap, atr and cci strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: vwapResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'vwap_reversion',
        rsiPeriod: 20,
        oversold: 3,
      }),
    )

    await act(async () => {
      await vwapResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'vwap_reversion',
      parameters: { period: 20, deviation_pct: 3 },
    })

    const { result: atrResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'atr_breakout',
        rsiPeriod: 14,
        oversold: 2,
      }),
    )

    await act(async () => {
      await atrResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'atr_breakout',
      parameters: { period: 14, multiplier: 2 },
    })

    const { result: cciResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'cci_reversal',
        rsiPeriod: 20,
        oversold: -100,
        overbought: 100,
      }),
    )

    await act(async () => {
      await cciResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[2][0]).toMatchObject({
      strategy_name: 'cci_reversal',
      parameters: { period: 20, oversold: -100, overbought: 100 },
    })
  })

  it('maps obv, dmi and chaikin strategy parameters into the backtest request', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: {} },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    const { result: obvResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'obv_trend',
        fast: 8,
        slow: 21,
      }),
    )

    await act(async () => {
      await obvResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[0][0]).toMatchObject({
      strategy_name: 'obv_trend',
      parameters: { fast: 8, slow: 21 },
    })

    const { result: dmiResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'dmi_breakout',
        rsiPeriod: 14,
        oversold: 25,
      }),
    )

    await act(async () => {
      await dmiResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[1][0]).toMatchObject({
      strategy_name: 'dmi_breakout',
      parameters: { period: 14, threshold: 25 },
    })

    const { result: chaikinResult } = renderHook(() =>
      useBacktestWorkspace({
        ...baseArgs,
        strategyName: 'chaikin_reversal',
        fast: 3,
        slow: 10,
      }),
    )

    await act(async () => {
      await chaikinResult.current.runBacktestNow()
    })

    expect(mockRunBacktest.mock.calls[2][0]).toMatchObject({
      strategy_name: 'chaikin_reversal',
      parameters: { fast: 3, slow: 10 },
    })
  })
})
