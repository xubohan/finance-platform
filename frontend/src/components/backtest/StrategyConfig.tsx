import { useState } from 'react'

import type { BacktestRequest } from '../../api/backtest'

type Props = {
  onRun: (payload: BacktestRequest) => Promise<void>
  loading: boolean
}

export default function StrategyConfig({ onRun, loading }: Props) {
  const [symbol, setSymbol] = useState('AAPL')
  const [fast, setFast] = useState(5)
  const [slow, setSlow] = useState(20)

  const submit = async () => {
    await onRun({
      symbol,
      asset_type: 'stock',
      strategy_name: 'ma_cross',
      parameters: { fast, slow },
      start_date: '2023-01-01',
      end_date: '2024-01-01',
      initial_capital: 1000000,
    })
  }

  return (
    <div className="form-row">
      <input className="text-input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
      <input className="text-input" type="number" value={fast} onChange={(e) => setFast(Number(e.target.value))} />
      <input className="text-input" type="number" value={slow} onChange={(e) => setSlow(Number(e.target.value))} />
      <button className="primary-btn" type="button" onClick={submit} disabled={loading}>
        {loading ? 'Running...' : 'Run Backtest'}
      </button>
    </div>
  )
}
