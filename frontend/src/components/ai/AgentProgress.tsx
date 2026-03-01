type Props = {
  status: string
  message: string
}

export default function AgentProgress({ status, message }: Props) {
  return (
    <div className="metric-card" style={{ marginTop: 12 }}>
      <small>Agent Status</small>
      <strong>{status.toUpperCase()}</strong>
      <span style={{ color: '#4d6485' }}>{message}</span>
    </div>
  )
}
