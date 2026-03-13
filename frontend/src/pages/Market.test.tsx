import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MarketPage from './Market'

const mockRunBacktest = vi.fn()
const mockSearchAssets = vi.fn()
const mockGetTopMovers = vi.fn()
const mockGetMarketSummary = vi.fn()
const mockGetKline = vi.fn()
const mockSyncHistory = vi.fn()
const mockGetHealth = vi.fn()

vi.mock('../api/backtest', () => ({
  runBacktest: (...args: unknown[]) => mockRunBacktest(...args),
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
}))

vi.mock('../components/chart/KlineChart', () => ({
  default: () => <div data-testid="kline-chart" />,
}))

vi.mock('../components/backtest/EquityCurve', () => ({
  default: () => <div data-testid="equity-curve" />,
}))

describe('MarketPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()

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
    mockRunBacktest.mockResolvedValue({
      data: { equity_curve: [], trades: [], metrics: { total_return: 5 } },
      meta: { storage_source: 'local', coverage_complete: true },
    })
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

    expect(mockGetMarketSummary).toHaveBeenCalledWith('AAPL')
    expect(mockGetMarketSummary).not.toHaveBeenCalledWith('BAD')
    expect(screen.getByDisplayValue('全部')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1D')).toBeInTheDocument()
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
      expect(screen.getByRole('button', { name: '导出当前回测 JSON' })).toBeInTheDocument()
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
