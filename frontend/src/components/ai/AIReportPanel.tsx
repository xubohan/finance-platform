type Props = {
  report: Record<string, any> | null
}

const fields = [
  ['Decision', 'decision'],
  ['Fundamental', 'fundamental'],
  ['Sentiment', 'sentiment'],
  ['News', 'news'],
  ['Technical', 'technical'],
  ['Bull Thesis', 'bull_thesis'],
  ['Bear Thesis', 'bear_thesis'],
  ['Risk', 'risk_assessment'],
  ['Plan', 'final_plan'],
] as const

export default function AIReportPanel({ report }: Props) {
  if (!report) return null

  return (
    <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
      {fields.map(([label, key]) => (
        <div key={key} className="metric-card">
          <small>{label}</small>
          <div>{typeof report[key] === 'object' ? JSON.stringify(report[key]) : String(report[key] ?? '-')}</div>
        </div>
      ))}
    </div>
  )
}
