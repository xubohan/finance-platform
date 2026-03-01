import { useState } from 'react'

import { runScreener } from '../api/screener'

type Row = {
  symbol: string
  name: string
  pe_ttm?: number
  roe?: number
  profit_yoy?: number
}

export default function ScreenerPage() {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<Row[]>([])

  const [minPe, setMinPe] = useState('')
  const [maxPe, setMaxPe] = useState('')
  const [minRoe, setMinRoe] = useState('')

  const handleRun = async () => {
    setLoading(true)
    try {
      const data = await runScreener({
        min_pe: minPe ? Number(minPe) : undefined,
        max_pe: maxPe ? Number(maxPe) : undefined,
        min_roe: minRoe ? Number(minRoe) : undefined,
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
      <p style={{ marginBottom: 16 }}>Stock-only filters. Crypto assets are intentionally excluded.</p>

      <div className="form-row">
        <input className="text-input" placeholder="Min PE" value={minPe} onChange={(e) => setMinPe(e.target.value)} />
        <input className="text-input" placeholder="Max PE" value={maxPe} onChange={(e) => setMaxPe(e.target.value)} />
        <input className="text-input" placeholder="Min ROE" value={minRoe} onChange={(e) => setMinRoe(e.target.value)} />
        <button className="primary-btn" type="button" onClick={handleRun} disabled={loading}>
          {loading ? 'Running...' : 'Run Screener'}
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Name</th>
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
