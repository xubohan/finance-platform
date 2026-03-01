type Metrics = {
  total_return?: number
  annual_return?: number
  sharpe_ratio?: number
  max_drawdown?: number
  win_rate?: number
  trade_count?: number
}

type Props = {
  metrics?: Metrics
}

export default function MetricsCards({ metrics }: Props) {
  if (!metrics) return null

  const items = [
    ['Total Return', `${metrics.total_return ?? 0}%`],
    ['Annual Return', `${metrics.annual_return ?? 0}%`],
    ['Sharpe', `${metrics.sharpe_ratio ?? 0}`],
    ['Max Drawdown', `${metrics.max_drawdown ?? 0}%`],
    ['Win Rate', `${metrics.win_rate ?? 0}%`],
    ['Trades', `${metrics.trade_count ?? 0}`],
  ]

  return (
    <div className="metrics-grid">
      {items.map(([k, v]) => (
        <div key={k} className="metric-card">
          <small>{k}</small>
          <strong>{v}</strong>
        </div>
      ))}
    </div>
  )
}
