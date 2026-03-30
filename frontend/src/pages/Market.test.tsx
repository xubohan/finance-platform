import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MarketPage from './Market'

const mockDownloadFile = vi.fn()
const mockClipboardWriteText = vi.fn()
const mockRunBacktest = vi.fn()
const mockCompareBacktestStrategies = vi.fn()
const mockGetBacktestStrategies = vi.fn()
const mockSearchAssets = vi.fn()
const mockGetTopMovers = vi.fn()
const mockGetMarketSummary = vi.fn()
const mockGetKline = vi.fn()
const mockSyncHistory = vi.fn()
const mockGetHealth = vi.fn()
const mockGetObservability = vi.fn()
const mockGetCacheMaintenance = vi.fn()
const mockGetDataStatus = vi.fn()
const mockCleanupCacheMaintenance = vi.fn()
const mockScrollIntoView = vi.fn()

vi.mock('../api/backtest', () => ({
  runBacktest: (...args: unknown[]) => mockRunBacktest(...args),
  compareBacktestStrategies: (...args: unknown[]) => mockCompareBacktestStrategies(...args),
  getBacktestStrategies: (...args: unknown[]) => mockGetBacktestStrategies(...args),
}))

vi.mock('../api/market', () => ({
  searchAssets: (...args: unknown[]) => mockSearchAssets(...args),
  getTopMovers: (...args: unknown[]) => mockGetTopMovers(...args),
  getMarketSummary: (...args: unknown[]) => mockGetMarketSummary(...args),
  getKline: (...args: unknown[]) => mockGetKline(...args),
  syncHistory: (...args: unknown[]) => mockSyncHistory(...args),
  toCandles: vi.fn(() => []),
}))

vi.mock('../api/system', () => ({
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
  getObservability: (...args: unknown[]) => mockGetObservability(...args),
  getCacheMaintenance: (...args: unknown[]) => mockGetCacheMaintenance(...args),
  getDataStatus: (...args: unknown[]) => mockGetDataStatus(...args),
  cleanupCacheMaintenance: (...args: unknown[]) => mockCleanupCacheMaintenance(...args),
}))

vi.mock('../utils/download', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}))

vi.mock('../components/chart/KlineChart', () => ({
  default: () => <div data-testid="kline-chart" />,
}))

vi.mock('../components/backtest/EquityCurve', () => ({
  default: () => <div data-testid="equity-curve" />,
}))

async function openCompareAdvancedTools() {
  const expandButton = await screen.findByRole('button', { name: '展开进阶工具' })
  await userEvent.click(expandButton)
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '收起进阶工具' })).toBeInTheDocument()
  })
}

async function openCompareReviewTools() {
  const expandButton = await screen.findByRole('button', { name: '展开复盘工具' })
  await userEvent.click(expandButton)
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '收起复盘工具' })).toBeInTheDocument()
  })
}

describe('MarketPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: mockScrollIntoView,
      writable: true,
    })
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: mockClipboardWriteText,
      },
    })
    mockClipboardWriteText.mockResolvedValue(undefined)
    mockScrollIntoView.mockReset()

    mockSearchAssets.mockResolvedValue({ data: [], meta: {} })
    mockGetTopMovers
      .mockResolvedValueOnce({ data: [], meta: { source: 'cache', stale: false, as_of: '2026-03-13T00:00:00+00:00', cache_age_sec: 120 } })
      .mockResolvedValueOnce({ data: [], meta: { source: 'live', stale: false, as_of: null, cache_age_sec: null } })
    mockGetMarketSummary.mockResolvedValue({
      data: {
        symbol: 'AAPL',
        asset_type: 'stock',
        quote: { symbol: 'AAPL', asset_type: 'stock', price: 100, change_pct_24h: 1.2, as_of: '2026-03-11T00:00:00+00:00' },
        history_status: { symbol: 'AAPL', asset_type: 'stock', local_rows: 100, local_start: '2026-01-01T00:00:00+00:00', local_end: '2026-03-11T00:00:00+00:00', has_data: true },
      },
      meta: { quote: { source: 'live', as_of: '2026-03-11T00:00:00+00:00' } },
    })
    mockGetKline.mockResolvedValue({ data: [], meta: { source: 'live', as_of: '2026-03-11T00:00:00+00:00' } })
    mockSyncHistory.mockResolvedValue({ data: null, meta: {} })
    mockGetHealth.mockResolvedValue({ status: 'ok', research_apis: false, ai_api: false })
    mockGetObservability.mockResolvedValue({
      uptime_sec: 300,
      http: { total_requests: 6, status_buckets: { '2xx': 6, '4xx': 0, '5xx': 0 }, routes: [], failing_routes: [] },
      counters: {},
    })
    mockGetCacheMaintenance.mockResolvedValue({
      market_snapshot_daily: { total_rows: 30, purgeable_rows: 3, retention_days: 45 },
      backtest_cache: { total_rows: 10, expired_rows: 2 },
    })
    mockGetDataStatus.mockResolvedValue({
      data: {
        provider_health: {
          summary: { status: 'ok', ok_checks: 6, degraded_checks: 0, error_checks: 0 },
          checks: [{ name: 'stock_quote_aapl', status: 'ok', details: { provider: 'twelvedata', stale: false } }],
        },
        llm: { model: 'gpt-5.3-codex', endpoint_path: '/v1/responses' },
      },
      meta: { generated_at: '2026-03-13T00:00:00+00:00', served_from_cache: false },
    })
    mockCleanupCacheMaintenance.mockResolvedValue({
      data: { dry_run: true, deleted_rows: { market_snapshot_daily: 3, backtest_cache: 2 } },
      meta: {},
    })
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: { total_return: 5 } },
      meta: { storage_source: 'local', coverage_complete: true },
    })
    mockCompareBacktestStrategies.mockResolvedValue({ data: [], meta: { count: 0 } })
    mockGetBacktestStrategies.mockResolvedValue({ data: [], meta: { count: 0 } })
  })

  it('restores persisted workspace state from localStorage without rewriting default asset', async () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        selectedAsset: { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' },
        searchScope: 'crypto',
        period: '1M',
        syncIfMissing: false,
      }),
    )
    window.localStorage.setItem(
      'market-workspace:recent-assets',
      JSON.stringify([{ symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' }]),
    )

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Bitcoin').length).toBeGreaterThan(0)
      expect(screen.getByDisplayValue('BTC')).toBeInTheDocument()
    })

    expect(mockGetMarketSummary).toHaveBeenCalledWith('BTC')
    expect(mockGetMarketSummary).not.toHaveBeenCalledWith('AAPL')

    const storedRecent = JSON.parse(window.localStorage.getItem('market-workspace:recent-assets') ?? '[]')
    expect(storedRecent[0]?.symbol).toBe('BTC')
  })

  it('ignores invalid persisted workspace values and keeps safe defaults', async () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        selectedAsset: { symbol: 'BAD', name: 'Broken', asset_type: 'broken-type', market: '??' },
        searchScope: 'broken-scope',
        period: '10Y',
        chartStartDate: '2026-99-99',
        backtestStartDate: 'not-a-date',
        fast: -3,
        initialCapital: -1,
      }),
    )

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Apple Inc.').length).toBeGreaterThan(0)
    })
    await waitFor(() => {
      expect(screen.getByDisplayValue('1D')).toBeInTheDocument()
    })

    expect(mockGetMarketSummary).toHaveBeenCalledWith('AAPL')
    expect(mockGetMarketSummary).not.toHaveBeenCalledWith('BAD')
    expect(screen.getByDisplayValue('全部')).toBeInTheDocument()
  })

  it('submits asset search when pressing Enter in the input', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '切换' })).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('输入代码或名称，例如 AAPL / 600519.SH / BTC')
    await userEvent.clear(input)
    await userEvent.type(input, 'BTC{enter}')

    await waitFor(() => {
      expect(mockGetMarketSummary).toHaveBeenLastCalledWith('BTC')
    })
  })

  it('ignores stale backtest results after switching asset', async () => {
    let resolveBacktest: ((value: unknown) => void) | null = null
    mockRunBacktest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBacktest = resolve
        }),
    )

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '运行当前回测' }))
    const input = screen.getByPlaceholderText('输入代码或名称，例如 AAPL / 600519.SH / BTC')
    await userEvent.clear(input)
    await userEvent.type(input, 'BTC')
    await userEvent.click(screen.getByRole('button', { name: '切换' }))

    resolveBacktest?.({
      data: { equity_curve: [], trades: [], metrics: { total_return: 99.99 } },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    await waitFor(() => {
      expect(screen.getAllByText('BTC').length).toBeGreaterThan(0)
    })

    expect(screen.queryByText('99.99%')).not.toBeInTheDocument()
  })

  it('keeps market and backtest actions inside their own panels', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '刷新数据' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '同步本地历史' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '导出回测JSON' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: '同步并刷新 K 线' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导出回测 JSON' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '快速运行回测' })).not.toBeInTheDocument()
  })

  it('renders workspace quick links and keeps chart before backtest', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '实时数据' })).toHaveAttribute('href', '#workspace-overview')
      expect(screen.getByRole('link', { name: 'K 线' })).toHaveAttribute('href', '#workspace-chart')
      expect(screen.getByRole('link', { name: '回测' })).toHaveAttribute('href', '#workspace-backtest')
    })

    const chartHeading = screen.getByRole('heading', { name: '实时行情与 K 线' })
    const backtestHeading = screen.getByRole('heading', { name: '单标的回测' })

    expect(chartHeading.compareDocumentPosition(backtestHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('link', { name: '笔记' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '研究笔记' })).not.toBeInTheDocument()
  })

  it('exposes provider health and cache cleanup actions in runtime panel', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByText('Provider Summary')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '预览清理' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '执行清理' })).toBeInTheDocument()
    })
  })

  it('scrolls smoothly to workspace sections from quick nav links', async () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    try {
      render(<MarketPage />)

      await waitFor(() => {
        expect(screen.getByRole('link', { name: 'K 线' })).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('link', { name: 'K 线' }))

      expect(mockScrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
      expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#workspace-chart')
    } finally {
      replaceStateSpy.mockRestore()
    }
  })

  it('keeps workspace quick nav inside the main column before overview content', async () => {
    const { container } = render(<MarketPage />)

    await waitFor(() => {
      expect(container.querySelector('.workspace-main .workspace-quick-nav')).not.toBeNull()
    })

    const mainQuickNav = container.querySelector('.workspace-main .workspace-quick-nav')
    const overviewSection = container.querySelector('.workspace-main #workspace-overview')

    expect(container.querySelector('.market-page > .workspace-quick-nav')).toBeNull()
    expect(mainQuickNav).not.toBeNull()
    expect(overviewSection).not.toBeNull()
    expect((mainQuickNav as Node).compareDocumentPosition(overviewSection as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps quote warning visible when summary returns partial success', async () => {
    mockGetMarketSummary.mockResolvedValueOnce({
      data: {
        symbol: 'AAPL',
        asset_type: 'stock',
        quote: null,
        history_status: { symbol: 'AAPL', asset_type: 'stock', local_rows: 100, local_start: '2026-01-01T00:00:00+00:00', local_end: '2026-03-11T00:00:00+00:00', has_data: true },
      },
      meta: { quote: null, quote_error: '报价暂时不可用' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByText('报价暂时不可用')).toBeInTheDocument()
      expect(screen.getAllByText('100 rows').length).toBeGreaterThan(0)
    })
  })

  it('renders movers freshness metadata on the page', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByText(/来源: 缓存/)).toBeInTheDocument()
      expect(screen.getByText(/新鲜度: 新鲜缓存/)).toBeInTheDocument()
      expect(screen.getByText(/来源: 实时/)).toBeInTheDocument()
    })
  })

  it('shows newly added backtest strategy options in the workspace', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    expect(screen.getByRole('option', { name: 'Buy And Hold' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'EMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'ALMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'LSMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'McGinley Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'T3 Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'TRIMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'SMMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VWMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'DEMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'ZLEMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'TEMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'WMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'HMA Cross' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Stochastic Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'DeMarker Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'CFO Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'SMI Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'BIAS Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Awesome Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Schaff Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ultimate Oscillator Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'StochRSI Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'RVI Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'MFI Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'CMO Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'DPO Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Williams Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Fisher Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Bollinger Reversion' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Donchian Breakout' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Supertrend Follow' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'ADX Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Chaikin Money Flow Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Chaikin Volatility Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Aroon Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'EFI Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VZO Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VHF Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'KST Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'PMO Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'ROC Breakout' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'LinReg Slope Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'TRIX Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'TSI Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Coppock Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Vortex Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Keltner Reversion' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VWAP Reversion' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'ATR Breakout' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'CCI Reversal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'OBV Trend' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'DMI Breakout' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Chaikin Reversal' })).toBeInTheDocument()
  })

  it('passes custom compare pool selections into the compare request', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    await openCompareAdvancedTools()
    expect(screen.getByRole('heading', { name: '策略对比池' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('对比排序'), 'max_drawdown')
    await userEvent.click(screen.getByRole('button', { name: 'Donchian Breakout' }))
    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy_names: ['ma_cross', 'buy_hold', 'ema_cross', 'macd_signal', 'rsi_reversal', 'donchian_breakout'],
          ranking_metric: 'max_drawdown',
        }),
      )
    })
  })

  it('applies compare templates and supports current-only compare mode', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '突破池' }))
    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy_names: ['ma_cross', 'donchian_breakout', 'atr_breakout', 'roc_breakout', 'dmi_breakout', 'supertrend_follow'],
        }),
      )
    })

    await userEvent.click(screen.getByRole('button', { name: '仅当前' }))
    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['ma_cross'],
          parameters_by_strategy: {
            ma_cross: { fast: 5, slow: 20 },
          },
        }),
      )
    })
  })

  it('keeps the previous primary strategy in the compare pool after manual strategy changes', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    await userEvent.selectOptions(screen.getByDisplayValue('MA Cross'), 'ema_cross')
    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['ema_cross', 'ma_cross', 'buy_hold', 'macd_signal', 'rsi_reversal'],
        }),
      )
    })
  })

  it('saves a custom compare template and reapplies it to the compare request', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    await openCompareAdvancedTools()
    await userEvent.selectOptions(screen.getByLabelText('对比排序'), 'max_drawdown')
    await userEvent.click(screen.getByRole('button', { name: 'Donchian Breakout' }))
    await userEvent.click(screen.getByRole('button', { name: '保存当前配置为模板' }))

    let savedTemplates: Array<{ label: string; compareRankingMetric: string; symbol: string; assetType: string }> = []
    await waitFor(() => {
      savedTemplates = JSON.parse(window.localStorage.getItem('market-workspace:saved-compare-templates') ?? '[]')
      expect(savedTemplates).toHaveLength(1)
      expect(savedTemplates[0]?.compareRankingMetric).toBe('max_drawdown')
      expect(savedTemplates[0]?.symbol).toBe('AAPL')
      expect(savedTemplates[0]?.assetType).toBe('stock')
    })

    await userEvent.click(screen.getByRole('button', { name: '仅当前' }))
    await userEvent.selectOptions(screen.getByLabelText('对比排序'), 'total_return')
    await userEvent.click(screen.getByRole('button', { name: `应用模板 ${savedTemplates[0]?.label}` }))
    await userEvent.click(screen.getByRole('button', { name: '应用并对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['ma_cross', 'buy_hold', 'ema_cross', 'macd_signal', 'rsi_reversal', 'donchian_breakout'],
          ranking_metric: 'max_drawdown',
        }),
      )
    })

    expect(JSON.parse(window.localStorage.getItem('market-workspace:saved-compare-templates') ?? '[]')).toHaveLength(1)
  })

  it('renames a saved custom compare template', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('趋势观察模板')
    try {
      render(<MarketPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '展开进阶工具' })).toBeInTheDocument()
      })

      await openCompareAdvancedTools()
      await userEvent.click(screen.getByRole('button', { name: '保存当前配置为模板' }))

      let savedTemplates: Array<{ label: string }> = []
      await waitFor(() => {
        savedTemplates = JSON.parse(window.localStorage.getItem('market-workspace:saved-compare-templates') ?? '[]')
        expect(savedTemplates).toHaveLength(1)
      })

      await userEvent.click(screen.getByRole('button', { name: `重命名自定义模板 ${savedTemplates[0]?.label}` }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '应用模板 趋势观察模板' })).toBeInTheDocument()
      })

      const renamedTemplates = JSON.parse(window.localStorage.getItem('market-workspace:saved-compare-templates') ?? '[]')
      expect(renamedTemplates[0]?.label).toBe('趋势观察模板')
    } finally {
      promptSpy.mockRestore()
    }
  })

  it('deletes a saved custom compare template', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开进阶工具' })).toBeInTheDocument()
    })

    await openCompareAdvancedTools()
    await userEvent.click(screen.getByRole('button', { name: '保存当前配置为模板' }))

    let savedTemplates: Array<{ label: string }> = []
    await waitFor(() => {
      savedTemplates = JSON.parse(window.localStorage.getItem('market-workspace:saved-compare-templates') ?? '[]')
      expect(savedTemplates).toHaveLength(1)
    })

    await userEvent.click(screen.getByRole('button', { name: `删除自定义模板 ${savedTemplates[0]?.label}` }))

    expect(screen.queryByRole('button', { name: `应用模板 ${savedTemplates[0]?.label}` })).not.toBeInTheDocument()
    expect(window.localStorage.getItem('market-workspace:saved-compare-templates')).toBeNull()
  })

  it('filters saved custom compare templates by current asset and falls back to all templates', async () => {
    window.localStorage.setItem(
      'market-workspace:saved-compare-templates',
      JSON.stringify([
        {
          id: 'tpl-aapl',
          label: 'AAPL 主模板',
          compareStrategyNames: ['buy_hold', 'ema_cross'],
          compareRankingMetric: 'total_return',
          symbol: 'AAPL',
          assetType: 'stock',
          createdAt: '2026-03-16T00:00:00+00:00',
        },
        {
          id: 'tpl-btc',
          label: 'BTC 防守模板',
          compareStrategyNames: ['buy_hold'],
          compareRankingMetric: 'sharpe_ratio',
          symbol: 'BTC',
          assetType: 'crypto',
          createdAt: '2026-03-16T01:00:00+00:00',
        },
      ]),
    )

    render(<MarketPage />)

    await openCompareAdvancedTools()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '当前标的 1' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '全部 2' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '应用模板 AAPL 主模板' })).toBeInTheDocument()
    })

    expect(screen.queryByRole('button', { name: '应用模板 BTC 防守模板' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '全部 2' }))

    expect(screen.getByRole('button', { name: '应用模板 BTC 防守模板' })).toBeInTheDocument()
    expect(screen.getByText(/标的 BTC \| 排序 夏普 \| 候选 2/)).toBeInTheDocument()
  })

  it('copies saved custom compare templates as json', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开进阶工具' })).toBeInTheDocument()
    })

    await openCompareAdvancedTools()
    await userEvent.click(screen.getByRole('button', { name: '保存当前配置为模板' }))
    await userEvent.click(screen.getByRole('button', { name: '复制模板JSON' }))

    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('"compareRankingMetric": "total_return"'))
    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('"symbol": "AAPL"'))
    expect(screen.getByText('模板JSON已复制。')).toBeInTheDocument()
  })

  it('imports saved custom compare templates from json', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(
      JSON.stringify([
        {
          id: 'tpl-import',
          label: '导入模板',
          compareStrategyNames: ['buy_hold', 'ema_cross'],
          compareRankingMetric: 'win_rate',
          symbol: 'BTC',
          assetType: 'crypto',
          createdAt: '2026-03-16T02:00:00+00:00',
        },
      ]),
    )

    try {
      render(<MarketPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '展开进阶工具' })).toBeInTheDocument()
      })

      await openCompareAdvancedTools()
      await userEvent.click(screen.getByRole('button', { name: '导入模板JSON' }))

      await waitFor(() => {
        expect(screen.getByText('模板JSON已导入。')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '应用模板 导入模板' })).toBeInTheDocument()
      })

      const savedTemplates = JSON.parse(window.localStorage.getItem('market-workspace:saved-compare-templates') ?? '[]')
      expect(savedTemplates).toHaveLength(1)
      expect(savedTemplates[0]?.symbol).toBe('BTC')
      expect(savedTemplates[0]?.compareRankingMetric).toBe('win_rate')
    } finally {
      promptSpy.mockRestore()
    }
  })

  it('restores a recent compare snapshot from local history', async () => {
    window.localStorage.setItem(
      'market-workspace:compare-snapshots',
      JSON.stringify([
        {
          symbol: 'BTC',
          assetType: 'crypto',
          strategyName: 'ema_cross',
          compareStrategyNames: ['buy_hold', 'macd_signal'],
          compareRankingMetric: 'total_return',
          fast: 8,
          slow: 21,
          rsiPeriod: 10,
          oversold: -5,
          overbought: 5,
          initialCapital: 250000,
          backtestStartDate: '2024-01-01',
          backtestEndDate: '2025-01-01',
          syncIfMissing: false,
          bestStrategyName: 'ema_cross',
          bestStrategyLabel: 'EMA Cross',
          currentRank: 1,
          storageSource: 'local',
          asOf: '2026-03-15T00:00:00+00:00',
          createdAt: '2026-03-15T01:00:00+00:00',
        },
      ]),
    )

    render(<MarketPage />)

    await openCompareAdvancedTools()
    await waitFor(() => {
      expect(screen.getByText(/恢复 BTC \/ EMA Cross \/ 总收益/)).toBeInTheDocument()
      expect(screen.getByText('当前 #1 / 3')).toBeInTheDocument()
      expect(screen.getByText('来源 local')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText(/恢复 BTC \/ EMA Cross \/ 总收益/))
    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          symbol: 'BTC',
          asset_type: 'crypto',
          strategy_names: ['ema_cross', 'buy_hold', 'macd_signal'],
          ranking_metric: 'total_return',
          initial_capital: 250000,
          start_date: '2024-01-01',
          end_date: '2025-01-01',
          sync_if_missing: false,
          parameters_by_strategy: {
            ema_cross: { fast: 8, slow: 21 },
          },
        }),
      )
    })
  })

  it('deletes a single recent compare snapshot without clearing the whole history', async () => {
    window.localStorage.setItem(
      'market-workspace:compare-snapshots',
      JSON.stringify([
        {
          symbol: 'BTC',
          assetType: 'crypto',
          strategyName: 'ema_cross',
          compareStrategyNames: ['buy_hold', 'macd_signal'],
          compareRankingMetric: 'total_return',
          fast: 8,
          slow: 21,
          rsiPeriod: 10,
          oversold: -5,
          overbought: 5,
          initialCapital: 250000,
          backtestStartDate: '2024-01-01',
          backtestEndDate: '2025-01-01',
          syncIfMissing: false,
          bestStrategyName: 'ema_cross',
          bestStrategyLabel: 'EMA Cross',
          currentRank: 1,
          storageSource: 'local',
          asOf: '2026-03-15T00:00:00+00:00',
          createdAt: '2026-03-15T01:00:00+00:00',
        },
        {
          symbol: 'ETH',
          assetType: 'crypto',
          strategyName: 'buy_hold',
          compareStrategyNames: ['ema_cross'],
          compareRankingMetric: 'sharpe_ratio',
          fast: 5,
          slow: 20,
          rsiPeriod: 14,
          oversold: 30,
          overbought: 70,
          initialCapital: 100000,
          backtestStartDate: '2024-06-01',
          backtestEndDate: '2025-06-01',
          syncIfMissing: true,
          bestStrategyName: 'buy_hold',
          bestStrategyLabel: 'Buy And Hold',
          currentRank: 1,
          storageSource: 'live',
          asOf: '2026-03-14T00:00:00+00:00',
          createdAt: '2026-03-14T01:00:00+00:00',
        },
      ]),
    )

    render(<MarketPage />)

    await openCompareAdvancedTools()
    await waitFor(() => {
      expect(screen.getByText(/恢复 BTC \/ EMA Cross \/ 总收益/)).toBeInTheDocument()
      expect(screen.getByText(/恢复 ETH \/ Buy And Hold \/ 夏普/)).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '删除最近对比快照 BTC / EMA Cross / 总收益' }))

    expect(screen.queryByText(/恢复 BTC \/ EMA Cross \/ 总收益/)).not.toBeInTheDocument()
    expect(screen.getByText(/恢复 ETH \/ Buy And Hold \/ 夏普/)).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('market-workspace:compare-snapshots') ?? '[]')).toHaveLength(1)
  })

  it('filters recent compare snapshots by current asset and expands full history on demand', async () => {
    window.localStorage.setItem(
      'market-workspace:compare-snapshots',
      JSON.stringify([
        {
          symbol: 'AAPL',
          assetType: 'stock',
          strategyName: 'ema_cross',
          compareStrategyNames: ['buy_hold'],
          compareRankingMetric: 'total_return',
          fast: 8,
          slow: 21,
          rsiPeriod: 14,
          oversold: 30,
          overbought: 70,
          initialCapital: 100000,
          backtestStartDate: '2024-01-01',
          backtestEndDate: '2025-01-01',
          syncIfMissing: true,
          bestStrategyName: 'ema_cross',
          bestStrategyLabel: 'EMA Cross',
          currentRank: 1,
          storageSource: 'local',
          asOf: '2026-03-15T00:00:00+00:00',
          createdAt: '2026-03-15T01:00:00+00:00',
        },
        {
          symbol: 'BTC',
          assetType: 'crypto',
          strategyName: 'buy_hold',
          compareStrategyNames: ['ema_cross'],
          compareRankingMetric: 'sharpe_ratio',
          fast: 5,
          slow: 20,
          rsiPeriod: 14,
          oversold: 30,
          overbought: 70,
          initialCapital: 100000,
          backtestStartDate: '2024-01-01',
          backtestEndDate: '2025-01-01',
          syncIfMissing: true,
          bestStrategyName: 'buy_hold',
          bestStrategyLabel: 'Buy And Hold',
          currentRank: 1,
          storageSource: 'live',
          asOf: '2026-03-14T00:00:00+00:00',
          createdAt: '2026-03-14T01:00:00+00:00',
        },
        {
          symbol: 'ETH',
          assetType: 'crypto',
          strategyName: 'ema_cross',
          compareStrategyNames: ['buy_hold'],
          compareRankingMetric: 'win_rate',
          fast: 8,
          slow: 21,
          rsiPeriod: 14,
          oversold: 30,
          overbought: 70,
          initialCapital: 120000,
          backtestStartDate: '2024-02-01',
          backtestEndDate: '2025-02-01',
          syncIfMissing: false,
          bestStrategyName: 'ema_cross',
          bestStrategyLabel: 'EMA Cross',
          currentRank: 2,
          storageSource: 'local',
          asOf: '2026-03-13T00:00:00+00:00',
          createdAt: '2026-03-13T01:00:00+00:00',
        },
        {
          symbol: 'SOL',
          assetType: 'crypto',
          strategyName: 'donchian_breakout',
          compareStrategyNames: ['buy_hold'],
          compareRankingMetric: 'annual_return',
          fast: 10,
          slow: 40,
          rsiPeriod: 14,
          oversold: 30,
          overbought: 70,
          initialCapital: 90000,
          backtestStartDate: '2024-03-01',
          backtestEndDate: '2025-03-01',
          syncIfMissing: true,
          bestStrategyName: 'donchian_breakout',
          bestStrategyLabel: 'Donchian Breakout',
          currentRank: 1,
          storageSource: 'live',
          asOf: '2026-03-12T00:00:00+00:00',
          createdAt: '2026-03-12T01:00:00+00:00',
        },
      ]),
    )

    render(<MarketPage />)

    await openCompareAdvancedTools()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '当前标的 1' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '全部 4' })).toBeInTheDocument()
      expect(screen.getByText(/恢复 AAPL \/ EMA Cross \/ 总收益/)).toBeInTheDocument()
    })

    expect(screen.queryByText(/恢复 BTC \/ Buy And Hold \/ 夏普/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '全部 4' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开全部 4' })).toBeInTheDocument()
      expect(screen.getByText(/恢复 BTC \/ Buy And Hold \/ 夏普/)).toBeInTheDocument()
      expect(screen.getByText(/恢复 ETH \/ EMA Cross \/ 胜率/)).toBeInTheDocument()
    })

    expect(screen.queryByText(/恢复 SOL \/ Donchian Breakout \/ 年化收益/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '展开全部 4' }))

    expect(screen.getByText(/恢复 SOL \/ Donchian Breakout \/ 年化收益/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起历史' })).toBeInTheDocument()
  })

  it('clears recent compare snapshots from local history', async () => {
    window.localStorage.setItem(
      'market-workspace:compare-snapshots',
      JSON.stringify([
        {
          symbol: 'BTC',
          assetType: 'crypto',
          strategyName: 'ema_cross',
          compareStrategyNames: ['buy_hold', 'macd_signal'],
          compareRankingMetric: 'total_return',
          fast: 8,
          slow: 21,
          rsiPeriod: 10,
          oversold: -5,
          overbought: 5,
          initialCapital: 250000,
          backtestStartDate: '2024-01-01',
          backtestEndDate: '2025-01-01',
          syncIfMissing: false,
          bestStrategyName: 'ema_cross',
          bestStrategyLabel: 'EMA Cross',
          currentRank: 1,
          storageSource: 'local',
          asOf: '2026-03-15T00:00:00+00:00',
          createdAt: '2026-03-15T01:00:00+00:00',
        },
      ]),
    )

    render(<MarketPage />)

    await openCompareAdvancedTools()
    await waitFor(() => {
      expect(screen.getByText(/恢复 BTC \/ EMA Cross \/ 总收益/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '清空最近对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '清空最近对比' }))

    expect(screen.queryByText(/恢复 BTC \/ EMA Cross \/ 总收益/)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('market-workspace:compare-snapshots')).toBeNull()
  })

  it('undoes compare template adjustments from the summary panel', async () => {
    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    await openCompareAdvancedTools()
    await userEvent.click(screen.getByRole('button', { name: '突破池' }))

    expect(screen.getByRole('button', { name: '撤销上一步调整' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '撤销上一步调整' }))

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['ma_cross', 'buy_hold', 'ema_cross', 'macd_signal', 'rsi_reversal'],
        }),
      )
    })
  })

  it('renders compare overview summary after compare finishes', async () => {
    mockCompareBacktestStrategies.mockResolvedValueOnce({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 10, annual_return: 4, sharpe_ratio: 0.8, max_drawdown: 9, win_rate: 0, trade_count: 1 },
      ],
      meta: { count: 3, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByText('当前策略排名')).toBeInTheDocument()
      expect(screen.getByText('#2 / 3')).toBeInTheDocument()
    })

    const bestStrategyCard = screen.getByText('最佳策略').closest('.summary-card')
    expect(bestStrategyCard).not.toBeNull()
    expect(within(bestStrategyCard as HTMLElement).getByText('EMA Cross')).toBeInTheDocument()

    const currentMetricCard = screen.getByText('当前总收益').closest('.summary-card')
    expect(currentMetricCard).not.toBeNull()
    expect(within(currentMetricCard as HTMLElement).getByText('12.00%')).toBeInTheDocument()

    const compareGapCard = screen.getByText('距最优总收益').closest('.summary-card')
    expect(compareGapCard).not.toBeNull()
    expect(within(compareGapCard as HTMLElement).getByText('3.00%')).toBeInTheDocument()

    const benchmarkGapCard = screen.getByText('相对 Buy&Hold 总收益').closest('.summary-card')
    expect(benchmarkGapCard).not.toBeNull()
    expect(within(benchmarkGapCard as HTMLElement).getByText('2.00%')).toBeInTheDocument()

    expect(screen.getByText(/对比快照: local/)).toBeInTheDocument()
    expect(screen.getByText('当前策略明显落后，建议切主策略')).toBeInTheDocument()
    const decisionCard = screen.getByText('对比结论').closest('.compare-decision-card')
    expect(decisionCard).not.toBeNull()
    expect(within(decisionCard as HTMLElement).getByText(/最佳策略是 EMA Cross/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '切到最佳并回测' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '对比JSON' })).not.toBeInTheDocument()
    await openCompareReviewTools()
    expect(screen.getByRole('button', { name: '对比JSON' })).toBeEnabled()
    await openCompareAdvancedTools()
    expect(screen.getByText(/恢复 AAPL \/ EMA Cross \/ 总收益/)).toBeInTheDocument()
  })

  it('renders compare decision guidance when current strategy leads but still trails buy and hold', async () => {
    mockCompareBacktestStrategies.mockResolvedValueOnce({
      data: [
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 8, annual_return: 4, sharpe_ratio: 1.4, max_drawdown: 6, win_rate: 55, trade_count: 8 },
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 6, annual_return: 3, sharpe_ratio: 1.1, max_drawdown: 7, win_rate: 52, trade_count: 6 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 10, annual_return: 5, sharpe_ratio: 0.8, max_drawdown: 9, win_rate: 0, trade_count: 1 },
      ],
      meta: { count: 3, ranking_metric: 'sharpe_ratio', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.selectOptions(screen.getByLabelText('对比排序'), 'sharpe_ratio')
    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByText('当前候选最优，但仍落后基准')).toBeInTheDocument()
      const decisionCard = screen.getByText('对比结论').closest('.compare-decision-card')
      expect(decisionCard).not.toBeNull()
      expect(within(decisionCard as HTMLElement).getByText(/仍落后 Buy&Hold 2.00%/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '切到 Buy&Hold 并回测' })).toBeInTheDocument()
    })
  })

  it('refreshes recent compare snapshot ordering after rerunning the same compare config', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await openCompareAdvancedTools()
    await waitFor(() => {
      expect(screen.getByText(/恢复 AAPL \/ EMA Cross \/ 总收益/)).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '仅当前' }))
    await userEvent.click(screen.getByRole('button', { name: '撤销上一步调整' }))
    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByText(/恢复 AAPL \/ EMA Cross \/ 总收益/)).toBeInTheDocument()
    })

    const storedSnapshots = JSON.parse(window.localStorage.getItem('market-workspace:compare-snapshots') ?? '[]')
    expect(storedSnapshots).toHaveLength(1)
    expect(storedSnapshots[0]?.bestStrategyName).toBe('ema_cross')
  })

  it('exports compare payload as json from the compare pool panel', async () => {
    mockCompareBacktestStrategies.mockResolvedValueOnce({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '对比JSON' }))

    expect(mockDownloadFile).toHaveBeenCalledWith(
      'AAPL_strategy_compare.json',
      expect.stringContaining('"compareRankingMetric": "total_return"'),
      'application/json;charset=utf-8',
    )
  })

  it('copies compare summary text from the compare pool panel', async () => {
    mockCompareBacktestStrategies.mockResolvedValueOnce({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '复制对比摘要' }))

    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('AAPL 策略对比'))
    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('最佳策略: EMA Cross'))
    expect(screen.getByText('对比摘要已复制。')).toBeInTheDocument()
  })

  it('auto clears copied compare summary feedback after the timeout', async () => {
    let usingFakeTimers = false
    mockCompareBacktestStrategies.mockResolvedValueOnce({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    try {
      render(<MarketPage />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: '对比' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
      })

      await userEvent.click(screen.getByRole('button', { name: '展开复盘工具' }))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '复制对比摘要' })).toBeInTheDocument()
      })

      vi.useFakeTimers()
      usingFakeTimers = true
      await act(async () => {
        screen.getByRole('button', { name: '复制对比摘要' }).click()
        await Promise.resolve()
      })

      expect(screen.getByText('对比摘要已复制。')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(2500)
      })

      expect(screen.queryByText('对比摘要已复制。')).not.toBeInTheDocument()
    } finally {
      if (usingFakeTimers) {
        vi.runOnlyPendingTimers()
        vi.useRealTimers()
      }
    }
  })

  it('copies compare broadcast text from the compare pool panel', async () => {
    mockCompareBacktestStrategies.mockResolvedValueOnce({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 10, annual_return: 4, sharpe_ratio: 0.8, max_drawdown: 9, win_rate: 0, trade_count: 1 },
      ],
      meta: { count: 3, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '复制播报文案' }))

    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('AAPL 回测复盘'))
    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('MA Cross 当前 #2 /'))
    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('最优 EMA Cross'))
    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('相对 Buy&Hold'))
    expect(screen.getByText('对比播报文案已复制。')).toBeInTheDocument()
  })

  it('clears copied broadcast state after compare pool changes', async () => {
    mockCompareBacktestStrategies.mockResolvedValueOnce({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 10, annual_return: 4, sharpe_ratio: 0.8, max_drawdown: 9, win_rate: 0, trade_count: 1 },
      ],
      meta: { count: 3, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '复制播报文案' }))

    expect(screen.getByText('对比播报文案已复制。')).toBeInTheDocument()

    await openCompareAdvancedTools()
    await userEvent.click(screen.getByRole('button', { name: 'Donchian Breakout' }))

    expect(screen.queryByText('对比播报文案已复制。')).not.toBeInTheDocument()
  })

  it('copies compare markdown table from the compare pool panel', async () => {
    mockCompareBacktestStrategies.mockResolvedValueOnce({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '复制Markdown表格' }))

    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('### AAPL 策略对比'))
    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('| 排名 | 策略 | 总收益 | 年化 | 夏普 | 最大回撤 | 胜率 | 成交数 |'))
    expect(mockClipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('| 1 | EMA Cross | 15.00% | 7.00% | 1.30 | 5.00% | 58.00% | 6 |'))
    expect(screen.getByText('对比Markdown已复制。')).toBeInTheDocument()
  })

  it('adopts the best compare strategy as the current strategy', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '设为当前策略' }))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'EMA Cross', selected: true })).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: '回到上一主策略: MA Cross' })).toBeInTheDocument()
    expect(screen.queryByText('最佳策略')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['ema_cross', 'ma_cross', 'buy_hold', 'macd_signal', 'rsi_reversal'],
        }),
      )
    })
  })

  it('adopts the best strategy and immediately reruns the current backtest', async () => {
    mockCompareBacktestStrategies.mockResolvedValueOnce({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [{ date: '2026-01-01', value: 100000 }], trades: [], metrics: { total_return: 5 } },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '设为当前并回测' }))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'EMA Cross', selected: true })).toBeInTheDocument()
      expect(mockRunBacktest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_name: 'ema_cross',
        }),
      )
    })
  })

  it('returns to the previous primary strategy from the summary shortcut', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '设为当前策略' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '回到上一主策略: MA Cross' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '回到上一主策略: MA Cross' }))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'MA Cross', selected: true })).toBeInTheDocument()
    })
  })

  it('undoes adopted best strategy back to the prior primary setup', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '设为当前策略' }))

    await openCompareAdvancedTools()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '撤销上一步调整' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '撤销上一步调整' }))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'MA Cross', selected: true })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['ma_cross', 'buy_hold', 'ema_cross', 'macd_signal', 'rsi_reversal'],
        }),
      )
    })
  })

  it('switches directly to a top compare candidate from the summary shortcuts', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 14, annual_return: 6, sharpe_ratio: 1.2, max_drawdown: 6, win_rate: 57, trade_count: 5 },
        { strategy_name: 'macd_signal', label: 'MACD Signal', total_return: 13, annual_return: 5.5, sharpe_ratio: 1.15, max_drawdown: 7, win_rate: 56, trade_count: 7 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 8, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 4, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '#2 Buy And Hold · 领先 2.00%' })).toBeEnabled()
    })

    await userEvent.click(screen.getByRole('button', { name: '#2 Buy And Hold · 领先 2.00%' }))

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Buy And Hold', selected: true })).toBeInTheDocument()
    })

    expect(screen.queryByText('最佳策略')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['buy_hold', 'ma_cross', 'ema_cross', 'macd_signal', 'rsi_reversal'],
        }),
      )
    })
  })

  it('keeps the top compare candidates for the next compare run', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 14, annual_return: 6, sharpe_ratio: 1.2, max_drawdown: 6, win_rate: 57, trade_count: 5 },
        { strategy_name: 'macd_signal', label: 'MACD Signal', total_return: 13, annual_return: 5.5, sharpe_ratio: 1.15, max_drawdown: 7, win_rate: 56, trade_count: 7 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 8, win_rate: 55, trade_count: 8 },
        { strategy_name: 'rsi_reversal', label: 'RSI Reversal', total_return: 10, annual_return: 4, sharpe_ratio: 0.9, max_drawdown: 9, win_rate: 51, trade_count: 9 },
      ],
      meta: { count: 5, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '保留前三候选' }))

    expect(screen.queryByText('最佳策略')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['ma_cross', 'ema_cross', 'buy_hold', 'macd_signal'],
        }),
      )
    })
  })

  it('keeps only better-than-current strategies for the next compare run', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'buy_hold', label: 'Buy And Hold', total_return: 14, annual_return: 6, sharpe_ratio: 1.2, max_drawdown: 6, win_rate: 57, trade_count: 5 },
        { strategy_name: 'macd_signal', label: 'MACD Signal', total_return: 13, annual_return: 5.5, sharpe_ratio: 1.15, max_drawdown: 7, win_rate: 56, trade_count: 7 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 8, win_rate: 55, trade_count: 8 },
        { strategy_name: 'rsi_reversal', label: 'RSI Reversal', total_return: 10, annual_return: 4, sharpe_ratio: 0.9, max_drawdown: 9, win_rate: 51, trade_count: 9 },
      ],
      meta: { count: 5, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开复盘工具' })).toBeInTheDocument()
    })

    await openCompareReviewTools()
    await userEvent.click(screen.getByRole('button', { name: '仅保留优于当前' }))

    expect(screen.queryByText('最佳策略')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['ma_cross', 'ema_cross', 'buy_hold', 'macd_signal'],
        }),
      )
    })
  })

  it('reruns compare from the summary after compare inputs change', async () => {
    mockCompareBacktestStrategies.mockResolvedValue({
      data: [
        { strategy_name: 'ema_cross', label: 'EMA Cross', total_return: 15, annual_return: 7, sharpe_ratio: 1.3, max_drawdown: 5, win_rate: 58, trade_count: 6 },
        { strategy_name: 'ma_cross', label: 'MA Cross', total_return: 12, annual_return: 5, sharpe_ratio: 1.1, max_drawdown: 6, win_rate: 55, trade_count: 8 },
      ],
      meta: { count: 2, ranking_metric: 'total_return', storage_source: 'local', as_of: '2026-03-15T00:00:00+00:00' },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '对比' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '对比' }))

    await waitFor(() => {
      expect(screen.getByText('最佳策略')).toBeInTheDocument()
    })

    await openCompareAdvancedTools()
    await userEvent.click(screen.getByRole('button', { name: 'Donchian Breakout' }))

    expect(screen.getByText('当前对比结果基于旧参数，需重新运行对比。')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '重跑对比' }))

    await waitFor(() => {
      expect(mockCompareBacktestStrategies).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_names: ['ma_cross', 'buy_hold', 'ema_cross', 'macd_signal', 'rsi_reversal', 'donchian_breakout'],
        }),
      )
    })
  })

  it('reruns backtest from the summary after strategy changes', async () => {
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [{ date: '2026-01-01', value: 100000 }], trades: [], metrics: { total_return: 5 } },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '运行当前回测' }))

    await waitFor(() => {
      expect(mockRunBacktest).toHaveBeenCalledTimes(1)
    })

    await userEvent.selectOptions(screen.getByDisplayValue('MA Cross'), 'ema_cross')

    expect(screen.getByText('当前回测结果基于旧参数，需重新运行当前回测。')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '重跑当前回测' }))

    await waitFor(() => {
      expect(mockRunBacktest).toHaveBeenLastCalledWith(
        expect.objectContaining({
          strategy_name: 'ema_cross',
        }),
      )
    })
  })

  it('persists backtest trade pagination after switching pages', async () => {
    mockRunBacktest.mockResolvedValueOnce({
      data: {
        equity_curve: [],
        trades: Array.from({ length: 10 }, (_, index) => ({
          date: `2026-01-${String(index + 1).padStart(2, '0')}`,
          symbol: 'AAPL',
          action: index % 2 === 0 ? 'buy' : 'sell',
          price: 100 + index,
          shares: 1,
          commission: 0,
          pnl: index,
        })),
        metrics: { total_return: 5 },
      },
      meta: { storage_source: 'local', coverage_complete: true },
    })

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '运行当前回测' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '运行当前回测' }))

    await waitFor(() => {
      expect(screen.getByText('成交记录第 1 / 2 页，共 10 笔')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '下一页成交记录' }))

    await waitFor(() => {
      expect(screen.getByText('成交记录第 2 / 2 页，共 10 笔')).toBeInTheDocument()
    })

    const persisted = JSON.parse(window.localStorage.getItem('market-workspace:state') ?? '{}')
    expect(persisted.backtestTradesPage).toBe(2)
  })

  it('clears recent assets from UI and localStorage', async () => {
    window.localStorage.setItem(
      'market-workspace:recent-assets',
      JSON.stringify([{ symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' }]),
    )

    render(<MarketPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '清空最近访问' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '清空最近访问' }))

    expect(screen.getByText('还没有最近访问标的。')).toBeInTheDocument()
    expect(window.localStorage.getItem('market-workspace:recent-assets')).toBeNull()
  })

  it('adds current asset to watchlist and clears it', async () => {
    render(<MarketPage />)

    await userEvent.click(screen.getByRole('button', { name: '加入自选' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '清空自选' })).toBeInTheDocument()
      expect(screen.getAllByText('Apple Inc.').length).toBeGreaterThan(0)
      expect(screen.getByText('自选快照')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: '清空自选' }))

    expect(screen.getByText('还没有加入自选的标的。')).toBeInTheDocument()
    expect(window.localStorage.getItem('market-workspace:watchlist-assets')).toBeNull()
  })
})
