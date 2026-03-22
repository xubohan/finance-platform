import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import BacktestPanel from './BacktestPanel'

const mockGetBacktestStrategies = vi.fn()

vi.mock('../backtest/EquityCurve', () => ({
  default: () => <div data-testid="equity-curve" />,
}))

vi.mock('../../api/backtest', () => ({
  getBacktestStrategies: (...args: unknown[]) => mockGetBacktestStrategies(...args),
}))

describe('BacktestPanel', () => {
  it('renders pagination controls for paged trades and dispatches page changes', async () => {
    mockGetBacktestStrategies.mockResolvedValue({ data: [], meta: { count: 0 } })
    const onPageChange = vi.fn()

    render(
      <BacktestPanel
        selectedSymbol="AAPL"
        selectedAssetType="stock"
        strategyName="ma_cross"
        fast={5}
        slow={20}
        rsiPeriod={14}
        oversold={30}
        overbought={70}
        initialCapital={100000}
        backtestStartDate="2025-01-01"
        backtestEndDate="2026-01-01"
        syncIfMissing={true}
        backtestTradesPage={2}
        backtestTradesTotal={10}
        backtestTradesPageCount={2}
        loadingBacktest={false}
        loadingCompare={false}
        backtestError={null}
        compareError={null}
        isBacktestStale={false}
        isCompareStale={false}
        backtestResult={{
          equity_curve: [{ date: '2026-01-01', value: 100000 }],
          trades: [
            { date: '2026-01-02', symbol: 'AAPL', action: 'sell', price: 110, shares: 1, commission: 0, pnl: 10 },
            { date: '2026-01-01', symbol: 'AAPL', action: 'buy', price: 100, shares: 1, commission: 0, pnl: 0 },
          ],
          metrics: {},
        }}
        backtestMeta={{ storage_source: 'local' }}
        compareRows={[]}
        trades={[
          { date: '2026-01-02', symbol: 'AAPL', action: 'sell', price: 110, shares: 1, commission: 0, pnl: 10 },
          { date: '2026-01-01', symbol: 'AAPL', action: 'buy', price: 100, shares: 1, commission: 0, pnl: 0 },
        ]}
        onStrategyChange={() => undefined}
        onFastChange={() => undefined}
        onSlowChange={() => undefined}
        onRsiPeriodChange={() => undefined}
        onOversoldChange={() => undefined}
        onOverboughtChange={() => undefined}
        onInitialCapitalChange={() => undefined}
        onBacktestStartDateChange={() => undefined}
        onBacktestEndDateChange={() => undefined}
        onSyncIfMissingChange={() => undefined}
        onBacktestTradesPageChange={onPageChange}
        onRunBacktest={() => undefined}
        onRunCompare={() => undefined}
        onPresetSelect={() => undefined}
        onExportBacktestJson={() => undefined}
        onExportCompareCsv={() => undefined}
        onExportEquityCurve={() => undefined}
        onExportTrades={() => undefined}
      />,
    )

    expect(screen.getByText('成交记录第 2 / 2 页，共 10 笔')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '上一页成交记录' }))
    expect(onPageChange).toHaveBeenCalledWith(1)
    expect(screen.getByRole('button', { name: '下一页成交记录' })).toBeDisabled()
  })

  it('shows backend-sourced strategy summary when metadata loads', async () => {
    mockGetBacktestStrategies.mockResolvedValue({
      data: [
        {
          name: 'ma_cross',
          label: 'MA Cross',
          parameter_mode: 'fast_slow',
          summary: 'Fast and slow signal crossover strategy.',
        },
      ],
      meta: { count: 1 },
    })

    render(
      <BacktestPanel
        selectedSymbol="AAPL"
        selectedAssetType="stock"
        strategyName="ma_cross"
        fast={5}
        slow={20}
        rsiPeriod={14}
        oversold={30}
        overbought={70}
        initialCapital={100000}
        backtestStartDate="2025-01-01"
        backtestEndDate="2026-01-01"
        syncIfMissing={true}
        backtestTradesPage={1}
        backtestTradesTotal={0}
        backtestTradesPageCount={1}
        loadingBacktest={false}
        loadingCompare={false}
        backtestError={null}
        compareError={null}
        isBacktestStale={false}
        isCompareStale={false}
        backtestResult={null}
        backtestMeta={null}
        compareRows={[]}
        trades={[]}
        onStrategyChange={() => undefined}
        onFastChange={() => undefined}
        onSlowChange={() => undefined}
        onRsiPeriodChange={() => undefined}
        onOversoldChange={() => undefined}
        onOverboughtChange={() => undefined}
        onInitialCapitalChange={() => undefined}
        onBacktestStartDateChange={() => undefined}
        onBacktestEndDateChange={() => undefined}
        onSyncIfMissingChange={() => undefined}
        onBacktestTradesPageChange={() => undefined}
        onRunBacktest={() => undefined}
        onRunCompare={() => undefined}
        onPresetSelect={() => undefined}
        onExportBacktestJson={() => undefined}
        onExportCompareCsv={() => undefined}
        onExportEquityCurve={() => undefined}
        onExportTrades={() => undefined}
      />,
    )

    expect(await screen.findByText('说明: Fast and slow signal crossover strategy.')).toBeInTheDocument()
  })

  it('renders strategy compare rows when compare data exists', async () => {
    mockGetBacktestStrategies.mockResolvedValue({ data: [], meta: { count: 0 } })

    render(
      <BacktestPanel
        selectedSymbol="AAPL"
        selectedAssetType="stock"
        strategyName="ma_cross"
        fast={5}
        slow={20}
        rsiPeriod={14}
        oversold={30}
        overbought={70}
        initialCapital={100000}
        backtestStartDate="2025-01-01"
        backtestEndDate="2026-01-01"
        syncIfMissing={true}
        backtestTradesPage={1}
        backtestTradesTotal={0}
        backtestTradesPageCount={1}
        loadingBacktest={false}
        loadingCompare={false}
        backtestError={null}
        compareError={null}
        isBacktestStale={false}
        isCompareStale={false}
        backtestResult={null}
        backtestMeta={null}
        compareRows={[
          { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: -6, win_rate: 55, trade_count: 8 },
          { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 10, annual_return: 4, sharpe_ratio: 0.9, max_drawdown: -8, win_rate: 0, trade_count: 0 },
        ]}
        trades={[]}
        onStrategyChange={() => undefined}
        onFastChange={() => undefined}
        onSlowChange={() => undefined}
        onRsiPeriodChange={() => undefined}
        onOversoldChange={() => undefined}
        onOverboughtChange={() => undefined}
        onInitialCapitalChange={() => undefined}
        onBacktestStartDateChange={() => undefined}
        onBacktestEndDateChange={() => undefined}
        onSyncIfMissingChange={() => undefined}
        onBacktestTradesPageChange={() => undefined}
        onRunBacktest={() => undefined}
        onRunCompare={() => undefined}
        onPresetSelect={() => undefined}
        onExportBacktestJson={() => undefined}
        onExportCompareCsv={() => undefined}
        onExportEquityCurve={() => undefined}
        onExportTrades={() => undefined}
      />,
    )

    expect(screen.getByText('对比表')).toBeInTheDocument()
    expect(screen.getAllByText('MA Cross').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Buy And Hold').length).toBeGreaterThan(0)
  })

  it('disables export buttons when results are stale', async () => {
    mockGetBacktestStrategies.mockResolvedValue({ data: [], meta: { count: 0 } })

    render(
      <BacktestPanel
        selectedSymbol="AAPL"
        selectedAssetType="stock"
        strategyName="ma_cross"
        fast={5}
        slow={20}
        rsiPeriod={14}
        oversold={30}
        overbought={70}
        initialCapital={100000}
        backtestStartDate="2025-01-01"
        backtestEndDate="2026-01-01"
        syncIfMissing={true}
        backtestTradesPage={1}
        backtestTradesTotal={1}
        backtestTradesPageCount={1}
        loadingBacktest={false}
        loadingCompare={false}
        backtestError={null}
        compareError={null}
        isBacktestStale={true}
        isCompareStale={true}
        backtestResult={{
          equity_curve: [{ date: '2026-01-01', value: 100000 }],
          trades: [{ date: '2026-01-01', symbol: 'AAPL', action: 'buy', price: 100, shares: 1, commission: 0, pnl: 0 }],
          metrics: { total_return: 12 },
        }}
        backtestMeta={{ storage_source: 'local' }}
        compareRows={[
          { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: -6, win_rate: 55, trade_count: 8 },
        ]}
        trades={[{ date: '2026-01-01', symbol: 'AAPL', action: 'buy', price: 100, shares: 1, commission: 0, pnl: 0 }]}
        onStrategyChange={() => undefined}
        onFastChange={() => undefined}
        onSlowChange={() => undefined}
        onRsiPeriodChange={() => undefined}
        onOversoldChange={() => undefined}
        onOverboughtChange={() => undefined}
        onInitialCapitalChange={() => undefined}
        onBacktestStartDateChange={() => undefined}
        onBacktestEndDateChange={() => undefined}
        onSyncIfMissingChange={() => undefined}
        onBacktestTradesPageChange={() => undefined}
        onRunBacktest={() => undefined}
        onRunCompare={() => undefined}
        onPresetSelect={() => undefined}
        onExportBacktestJson={() => undefined}
        onExportCompareCsv={() => undefined}
        onExportEquityCurve={() => undefined}
        onExportTrades={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: '导出回测JSON' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '对比CSV' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导出权益CSV' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导出成交CSV' })).toBeDisabled()
  })

})
