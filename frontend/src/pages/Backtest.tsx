import { useState } from 'react'

import type { BacktestRequest } from '../api/backtest'
import { runBacktest } from '../api/backtest'
import EquityCurve from '../components/backtest/EquityCurve'
import MetricsCards from '../components/backtest/MetricsCards'
import StrategyConfig from '../components/backtest/StrategyConfig'

type Result = {
  equity_curve: Array<{ date: string; value: number }>
  metrics: {
    total_return: number
    annual_return: number
    sharpe_ratio: number
    max_drawdown: number
    win_rate: number
    trade_count: number
  }
}

export default function BacktestPage() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const handleRun = async (payload: BacktestRequest) => {
    setLoading(true)
    try {
      const data = await runBacktest(payload)
      setResult(data)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="page-card">
      <h2>Backtest Lab</h2>
      <p style={{ marginBottom: 12 }}>Configure strategy parameters and run historical simulation.</p>

      <StrategyConfig onRun={handleRun} loading={loading} />
      <MetricsCards metrics={result?.metrics} />

      {result?.equity_curve?.length ? (
        <div style={{ marginTop: 16 }}>
          <EquityCurve points={result.equity_curve} />
        </div>
      ) : null}
    </section>
  )
}
