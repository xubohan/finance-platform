type Props = {
  newsCount: number
  eventCount: number
}

export default function MarkerLegend({ newsCount, eventCount }: Props) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <span className="chip" style={{ borderColor: 'rgba(22, 136, 231, 0.45)' }}>
        News {newsCount}
      </span>
      <span className="chip" style={{ borderColor: 'rgba(255, 152, 0, 0.45)' }}>
        Events {eventCount}
      </span>
    </div>
  )
}
