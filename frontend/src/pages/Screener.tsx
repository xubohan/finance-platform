import { useEffect, useState } from 'react'

import { getScreenerSymbols, runScreener, type ScreenerMarket } from '../api/screener'

type Row = {
  symbol: string
  name: string
  market?: string
  pe_ttm?: number
  roe?: number
  profit_yoy?: number
}

export default function ScreenerPage() {
  const [loading, setLoading] = useState(false)
  const [loadingSymbols, setLoadingSymbols] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [latestSymbols, setLatestSymbols] = useState<Array<{ symbol: string; name: string }>>([])

  const [minPe, setMinPe] = useState('')
  const [maxPe, setMaxPe] = useState('')
  const [minRoe, setMinRoe] = useState('')
  const [market, setMarket] = useState<ScreenerMarket>('us')

  useEffect(() => {
    const loadSymbols = async () => {
      setLoadingSymbols(true)
      try {
        const data = await getScreenerSymbols(market, 20)
        setLatestSymbols(data)
      } catch {
        setLatestSymbols([])
      } finally {
        setLoadingSymbols(false)
      }
    }

    void loadSymbols()
  }, [market])

  const handleRun = async () => {
    setLoading(true)
    try {
      const data = await runScreener({
        min_pe: minPe ? Number(minPe) : undefined,
        max_pe: maxPe ? Number(maxPe) : undefined,
        min_roe: minRoe ? Number(minRoe) : undefined,
        market,
        refresh_latest: true,
        symbol_limit: 20,
        limit: 50,
      })
      setRows(data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="page-card">
      <h2>Stock Screener</h2>
      <p style={{ marginBottom: 16 }}>Latest stock fundamentals. Market supports US and A-share only.</p>

      <div className="form-row">
        <select className="text-input" value={market} onChange={(e) => setMarket(e.target.value as ScreenerMarket)}>
          <option value="us">US Stocks</option>
          <option value="cn">A Shares (CN)</option>
          <option value="all">US + A Shares</option>
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
    </section>
  )
}
