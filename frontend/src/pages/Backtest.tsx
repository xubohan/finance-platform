import { useEffect, useState } from 'react'

import { extractApiError } from '../api/client'
import { runBacktestLab, type BacktestLabRequest, type BacktestLabRow } from '../api/backtest'

export default function BacktestPage() {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<BacktestLabRow[]>([])
  const [market, setMarket] = useState<'us' | 'cn'>('us')
  const [strategyName, setStrategyName] = useState<'ma_cross' | 'macd_signal' | 'rsi_reversal'>('ma_cross')
  const [fast, setFast] = useState(5)
  const [slow, setSlow] = useState(20)
  const [period, setPeriod] = useState(14)
  const [oversold, setOversold] = useState(30)
  const [overbought, setOverbought] = useState(70)
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState('2024-01-01')
  const [initialCapital, setInitialCapital] = useState(1000000)
  const [symbolLimit, setSymbolLimit] = useState(20000)
  const [totalAvailable, setTotalAvailable] = useState(0)
  const [symbolsFetched, setSymbolsFetched] = useState(0)
  const [symbolsBacktested, setSymbolsBacktested] = useState(0)
  const [totalItems, setTotalItems] = useState(0)
  const [source, setSource] = useState<string>('-')
  const [asOf, setAsOf] = useState<string>('-')
  const [ohlcvLive, setOhlcvLive] = useState(0)
  const [ohlcvFailed, setOhlcvFailed] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [hasRun, setHasRun] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buildPayload = (targetPage: number): BacktestLabRequest => {
    const parameters: Record<string, number> = {}
    if (strategyName === 'ma_cross') {
      parameters.fast = fast
      parameters.slow = slow
    } else if (strategyName === 'rsi_reversal') {
      parameters.period = period
      parameters.oversold = oversold
      parameters.overbought = overbought
    }
    return {
      market,
      strategy_name: strategyName,
      parameters,
      start_date: startDate,
      end_date: endDate,
      initial_capital: initialCapital,
      symbol_limit: symbolLimit,
      page: targetPage,
      page_size: 50,
    }
  }

  const runPage = async (targetPage: number) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await runBacktestLab(buildPayload(targetPage))
      setRows(resp.data)
      setTotalAvailable(Number(resp.meta.total_available ?? 0))
      setSymbolsFetched(Number(resp.meta.symbols_fetched ?? 0))
      setSymbolsBacktested(Number(resp.meta.symbols_backtested ?? 0))
      setTotalItems(Number(resp.meta.total_items ?? 0))
      setSource(resp.meta.source ?? '-')
      setAsOf(resp.meta.as_of ?? '-')
      setOhlcvLive(Number(resp.meta.ohlcv_live_symbols ?? 0))
      setOhlcvFailed(Number(resp.meta.ohlcv_failed_symbols ?? 0))
      setPage(Number(resp.meta.page ?? targetPage))
      setTotalPages(Number(resp.meta.total_pages ?? 1))
      setHasRun(true)
    } catch (err) {
      setError(extractApiError(err, 'Failed to run market backtest with live data'))
    } finally {
      setLoading(false)
    }
  }

  const handleRun = async () => {
    await runPage(1)
  }

  useEffect(() => {
    setRows([])
    setTotalAvailable(0)
    setSymbolsFetched(0)
    setSymbolsBacktested(0)
    setTotalItems(0)
    setSource('-')
    setAsOf('-')
    setOhlcvLive(0)
    setOhlcvFailed(0)
    setPage(1)
    setTotalPages(1)
    setHasRun(false)
    setError(null)
  }, [market])

  const gotoPrev = async () => {
    if (loading || page <= 1) return
    await runPage(page - 1)
  }

  const gotoNext = async () => {
    if (loading || page >= totalPages) return
    await runPage(page + 1)
  }

  return (
    <section className="page-card">
      <h2>Backtest Lab</h2>
      <p style={{ marginBottom: 12 }}>按所选市场做全量股票策略回测，结果分页展示（50/页）。</p>

      <div className="form-row">
        <select className="text-input" value={market} onChange={(e) => setMarket(e.target.value as 'us' | 'cn')}>
          <option value="us">US Stocks</option>
          <option value="cn">A Shares (CN)</option>
        </select>
        <select
          className="text-input"
          value={strategyName}
          onChange={(e) => setStrategyName(e.target.value as 'ma_cross' | 'macd_signal' | 'rsi_reversal')}
        >
          <option value="ma_cross">MA Cross</option>
          <option value="macd_signal">MACD Signal</option>
          <option value="rsi_reversal">RSI Reversal</option>
        </select>
        <input
          className="text-input"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <input
          className="text-input"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <input
          className="text-input"
          type="number"
          value={symbolLimit}
          min={50}
          max={20000}
          onChange={(e) => setSymbolLimit(Number(e.target.value))}
          placeholder="Universe Limit"
        />
        <button className="primary-btn" type="button" onClick={handleRun} disabled={loading}>
          {loading ? 'Running...' : 'Run Market Backtest'}
        </button>
      </div>

      {strategyName === 'ma_cross' ? (
        <div className="form-row" style={{ marginTop: 10 }}>
          <input
            className="text-input"
            type="number"
            value={fast}
            onChange={(e) => setFast(Number(e.target.value))}
            placeholder="Fast MA"
          />
          <input
            className="text-input"
            type="number"
            value={slow}
            onChange={(e) => setSlow(Number(e.target.value))}
            placeholder="Slow MA"
          />
        </div>
      ) : null}

      {strategyName === 'rsi_reversal' ? (
        <div className="form-row" style={{ marginTop: 10 }}>
          <input
            className="text-input"
            type="number"
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            placeholder="RSI Period"
          />
          <input
            className="text-input"
            type="number"
            value={oversold}
            onChange={(e) => setOversold(Number(e.target.value))}
            placeholder="Oversold"
          />
          <input
            className="text-input"
            type="number"
            value={overbought}
            onChange={(e) => setOverbought(Number(e.target.value))}
            placeholder="Overbought"
          />
        </div>
      ) : null}

      <div className="form-row" style={{ marginTop: 10 }}>
        <input
          className="text-input"
          type="number"
          value={initialCapital}
          onChange={(e) => setInitialCapital(Number(e.target.value))}
          placeholder="Initial Capital"
        />
      </div>

      <p style={{ marginTop: 12, marginBottom: 10, color: '#4d6485' }}>
        可选总数: {totalAvailable.toLocaleString()} | 本次扫描: {symbolsFetched.toLocaleString()} | 成功回测: {symbolsBacktested.toLocaleString()} | 结果总数: {totalItems.toLocaleString()} | K线成功: {ohlcvLive.toLocaleString()} | K线失败: {ohlcvFailed.toLocaleString()} | 数据源: {source} | As Of: {asOf}
      </p>
      {error ? <p className="warn-text">{error}</p> : null}

      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Symbol</th>
            <th>Name</th>
            <th>Market</th>
            <th>Total Return</th>
            <th>Annual</th>
            <th>Sharpe</th>
            <th>Max DD</th>
            <th>Win Rate</th>
            <th>Trades</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.symbol}>
              <td>{(page - 1) * 50 + idx + 1}</td>
              <td>{row.symbol}</td>
              <td>{row.name}</td>
              <td>{row.market}</td>
              <td>{row.total_return.toFixed(2)}%</td>
              <td>{row.annual_return.toFixed(2)}%</td>
              <td>{row.sharpe_ratio.toFixed(2)}</td>
              <td>{row.max_drawdown.toFixed(2)}%</td>
              <td>{row.win_rate.toFixed(2)}%</td>
              <td>{row.trade_count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {hasRun ? (
        <div className="form-row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <span style={{ color: '#4d6485' }}>页码: {page}/{totalPages}（每页 50 条）</span>
          <div className="form-row">
            <button className="primary-btn" type="button" onClick={gotoPrev} disabled={loading || page <= 1}>
              Prev
            </button>
            <button className="primary-btn" type="button" onClick={gotoNext} disabled={loading || page >= totalPages}>
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
