import type { OscillatorMode } from '../chart/KlineChart'

type Props = {
  value: OscillatorMode
  onChange: (next: OscillatorMode) => void
}

const OPTIONS: Array<{ value: OscillatorMode; label: string }> = [
  { value: 'none', label: '副图关闭' },
  { value: 'MACD', label: 'MACD' },
  { value: 'KDJ', label: 'KDJ' },
  { value: 'RSI', label: 'RSI' },
]

export default function OscillatorSwitcher({ value, onChange }: Props) {
  return (
    <div className="chip-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {OPTIONS.map((item) => (
        <button
          key={item.value}
          type="button"
          className={value === item.value ? 'chip chip-active' : 'chip'}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
