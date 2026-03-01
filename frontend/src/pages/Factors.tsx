import { useMemo, useState } from 'react'

import { scoreFactors, type FactorWeights } from '../api/factors'

type FactorRow = {
  symbol: string
  name: string
  total_score: number
  value_score: number
  growth_score: number
  momentum_score: number
  quality_score: number
  pe_ttm?: number
  roe?: number
}

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

  const total = useMemo(
    () => weights.value + weights.growth + weights.momentum + weights.quality,
    [weights],
  )

  const handleWeight = (key: keyof FactorWeights, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }))
  }

  const handleRun = async () => {
    if (total !== 100) return
    setLoading(true)
    try {
      const data = await scoreFactors(weights, 50)
      setRows(data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="page-card">
      <h2>Factor Ranking</h2>
      <p style={{ marginBottom: 16 }}>Stocks only. Crypto does not appear on factor ranking page.</p>

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
              <td>{idx + 1}</td>
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
    </section>
  )
}
