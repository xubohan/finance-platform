import { useEffect, useMemo, useState } from 'react'

import { extractApiError } from '../api/client'
import { scoreFactors, type FactorMarket, type FactorRow, type FactorWeights } from '../api/factors'

const factorList: Array<keyof FactorWeights> = ['value', 'growth', 'momentum', 'quality']

export default function FactorsPage() {
  const [weights, setWeights] = useState<FactorWeights>({
    value: 25,
    growth: 25,
    momentum: 25,
    quality: 25,
  })
  const [rows, setRows] = useState<FactorRow[]>([])
  const [loading, setLoading] = useState(false)
  const [market, setMarket] = useState<FactorMarket>('us')
  const [totalAvailable, setTotalAvailable] = useState<number>(0)
  const [symbolsFetched, setSymbolsFetched] = useState<number>(0)
  const [totalItems, setTotalItems] = useState<number>(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [hasRun, setHasRun] = useState(false)
  const [source, setSource] = useState<string>('-')
  const [asOf, setAsOf] = useState<string>('-')
  const [error, setError] = useState<string | null>(null)

  const total = useMemo(
    () => weights.value + weights.growth + weights.momentum + weights.quality,
    [weights],
  )

  const handleWeight = (key: keyof FactorWeights, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }))
  }

  useEffect(() => {
    setRows([])
    setTotalAvailable(0)
    setSymbolsFetched(0)
    setTotalItems(0)
    setPage(1)
    setTotalPages(1)
    setHasRun(false)
    setSource('-')
    setAsOf('-')
    setError(null)
  }, [market])

  const runFactorsPage = async (targetPage: number) => {
    if (total !== 100) return
    setLoading(true)
    setError(null)
    try {
      const resp = await scoreFactors(weights, market, targetPage, 50, 20000)
      setRows(resp.data)
      setTotalAvailable(Number(resp.meta.total_available ?? 0))
      setSymbolsFetched(Number(resp.meta.symbols_fetched ?? 0))
      setTotalItems(Number(resp.meta.total_items ?? 0))
      setPage(Number(resp.meta.page ?? targetPage))
      setTotalPages(Number(resp.meta.total_pages ?? 1))
      setSource(resp.meta.source ?? '-')
      setAsOf(resp.meta.as_of ?? '-')
      setHasRun(true)
    } catch (err) {
      setError(extractApiError(err, 'Failed to calculate factors with live market data'))
    } finally {
      setLoading(false)
    }
  }

  const handleRun = async () => {
    await runFactorsPage(1)
  }

  const gotoPrev = async () => {
    if (loading || page <= 1) return
    await runFactorsPage(page - 1)
  }

  const gotoNext = async () => {
    if (loading || page >= totalPages) return
    await runFactorsPage(page + 1)
  }

  return (
    <section className="page-card">
      <h2>Factor Ranking</h2>
      <p style={{ marginBottom: 16 }}>Stocks only. Crypto does not appear on factor ranking page.</p>
      <div className="form-row" style={{ marginBottom: 12 }}>
        <select className="text-input" value={market} onChange={(e) => setMarket(e.target.value as FactorMarket)}>
          <option value="us">US Stocks</option>
          <option value="cn">A Shares (CN)</option>
        </select>
        <span style={{ color: '#4d6485' }}>
          可选总数: {totalAvailable.toLocaleString()} | 本次扫描: {symbolsFetched.toLocaleString()} | 排名总数: {totalItems.toLocaleString()}
          {' '}| 数据源: {source} | As Of: {asOf}
        </span>
      </div>
      {error ? <p className="warn-text">{error}</p> : null}

      <div className="slider-wrap">
        {factorList.map((factor) => (
          <label key={factor} className="slider-item">
            <span>
              {factor.toUpperCase()} {weights[factor]}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={weights[factor]}
              onChange={(e) => handleWeight(factor, Number(e.target.value))}
            />
          </label>
        ))}
      </div>

      <div className="form-row" style={{ marginTop: 12 }}>
        <span className={total === 100 ? 'ok-text' : 'warn-text'}>Weight Sum: {total}</span>
        <button className="primary-btn" type="button" onClick={handleRun} disabled={loading || total !== 100}>
          {loading ? 'Calculating...' : 'Recalculate'}
        </button>
      </div>

      <table className="table" style={{ marginTop: 16 }}>
        <thead>
          <tr>
            <th>#</th>
            <th>Symbol</th>
            <th>Name</th>
            <th>Total</th>
            <th>Value</th>
            <th>Growth</th>
            <th>Momentum</th>
            <th>Quality</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.symbol}>
              <td>{(page - 1) * 50 + idx + 1}</td>
              <td>{row.symbol}</td>
              <td>{row.name}</td>
              <td>{row.total_score?.toFixed?.(1)}</td>
              <td>{row.value_score?.toFixed?.(1)}</td>
              <td>{row.growth_score?.toFixed?.(1)}</td>
              <td>{row.momentum_score?.toFixed?.(1)}</td>
              <td>{row.quality_score?.toFixed?.(1)}</td>
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
