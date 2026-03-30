import type { MarketDetailPeriod } from '../../api/market'

type PeriodOption = {
  value: MarketDetailPeriod
  label: string
}

type Props = {
  value: MarketDetailPeriod
  options: PeriodOption[]
  fallbackHint?: string | null
  onChange: (next: MarketDetailPeriod) => void
}

export default function PeriodSwitcher({ value, options, fallbackHint, onChange }: Props) {
  return (
    <div className="period-tabs" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {options.map((item) => (
        <button
          key={item.value}
          type="button"
          className={value === item.value ? 'chip chip-active' : 'chip'}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
      {fallbackHint ? (
        <span className="chip" title={fallbackHint} style={{ borderStyle: 'dashed' }}>
          {fallbackHint}
        </span>
      ) : null}
    </div>
  )
}
