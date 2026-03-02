import { useEffect, useState } from 'react'

import { getScreenerSymbols, runScreener, type ScreenerMarket, type ScreenerRow } from '../api/screener'

export default function ScreenerPage() {
  const [loading, setLoading] = useState(false)
  const [loadingSymbols, setLoadingSymbols] = useState(false)
  const [rows, setRows] = useState<ScreenerRow[]>([])
  const [latestSymbols, setLatestSymbols] = useState<Array<{ symbol: string; name: string }>>([])
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null)
  const [lastScanned, setLastScanned] = useState<number>(0)
  const [totalMatched, setTotalMatched] = useState<number>(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [hasRun, setHasRun] = useState(false)

  const [minPe, setMinPe] = useState('')
  const [maxPe, setMaxPe] = useState('')
  const [minRoe, setMinRoe] = useState('')
  const [market, setMarket] = useState<ScreenerMarket>('us')

  useEffect(() => {
    setRows([])
    setLastScanned(0)
    setTotalMatched(0)
    setPage(1)
    setTotalPages(1)
    setHasRun(false)

    const loadSymbols = async () => {
      setLoadingSymbols(true)
      try {
        const resp = await getScreenerSymbols(market, 20)
        setLatestSymbols(resp.data.map((item) => ({ symbol: item.symbol, name: item.name })))
        setTotalAvailable(typeof resp.meta.total_available === 'number' ? resp.meta.total_available : null)
      } catch {
        setLatestSymbols([])
        setTotalAvailable(null)
      } finally {
        setLoadingSymbols(false)
      }
    }

    void loadSymbols()
  }, [market])

  const runQuery = async (targetPage: number) => {
    setLoading(true)
    try {
      const resp = await runScreener({
        min_pe: minPe ? Number(minPe) : undefined,
        max_pe: maxPe ? Number(maxPe) : undefined,
        min_roe: minRoe ? Number(minRoe) : undefined,
        market,
        symbol_limit: 20000,
        page: targetPage,
        page_size: 50,
      })
      setRows(resp.data)
      setLastScanned(Number(resp.meta.symbols_fetched ?? 0))
      setTotalMatched(Number(resp.meta.total_items ?? 0))
      setPage(Number(resp.meta.page ?? targetPage))
      setTotalPages(Number(resp.meta.total_pages ?? 1))
      if (typeof resp.meta.total_available === 'number') {
        setTotalAvailable(resp.meta.total_available)
      }
      setHasRun(true)
    } finally {
      setLoading(false)
    }
  }

  const handleRun = async () => {
    await runQuery(1)
  }

  const gotoPrev = async () => {
    if (page <= 1 || loading) return
    await runQuery(page - 1)
  }

  const gotoNext = async () => {
    if (page >= totalPages || loading) return
    await runQuery(page + 1)
  }

  return (
    <section className="page-card">
      <h2>Stock Screener</h2>
      <p style={{ marginBottom: 16 }}>Latest stock fundamentals. Market supports US and A-share only.</p>

      <div className="form-row">
        <select className="text-input" value={market} onChange={(e) => setMarket(e.target.value as ScreenerMarket)}>
          <option value="us">US Stocks</option>
          <option value="cn">A Shares (CN)</option>
        </select>
        <input className="text-input" placeholder="Min PE" value={minPe} onChange={(e) => setMinPe(e.target.value)} />
        <input className="text-input" placeholder="Max PE" value={maxPe} onChange={(e) => setMaxPe(e.target.value)} />
        <input className="text-input" placeholder="Min ROE" value={minRoe} onChange={(e) => setMinRoe(e.target.value)} />
        <button className="primary-btn" type="button" onClick={handleRun} disabled={loading}>
          {loading ? 'Running...' : 'Run Screener'}
        </button>
      </div>

      <p style={{ marginTop: 12, marginBottom: 10, color: '#4d6485' }}>
        Latest symbols from API:
        {' '}
        {loadingSymbols
          ? 'loading...'
          : latestSymbols.slice(0, 8).map((item) => item.symbol).join(', ') || 'none'}
      </p>
      <p style={{ marginTop: 4, marginBottom: 14, color: '#4d6485' }}>
        可选总数:
        {' '}
        {totalAvailable === null ? '-' : totalAvailable.toLocaleString()}
        {' '}| 本次扫描:
        {' '}
        {lastScanned.toLocaleString()}
        {' '}| 命中总数:
        {' '}
        {totalMatched.toLocaleString()}
        {' '}| 页码:
        {' '}
        {page}
        /
        {totalPages}
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Name</th>
            <th>Market</th>
            <th>PE</th>
            <th>ROE</th>
            <th>Profit YoY</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.symbol}>
              <td>{row.symbol}</td>
              <td>{row.name}</td>
              <td>{row.market ?? '-'}</td>
              <td>{row.pe_ttm?.toFixed?.(2) ?? '-'}</td>
              <td>{row.roe?.toFixed?.(2) ?? '-'}</td>
              <td>{row.profit_yoy?.toFixed?.(2) ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasRun ? (
        <div className="form-row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <span style={{ color: '#4d6485' }}>每页 50 条</span>
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
