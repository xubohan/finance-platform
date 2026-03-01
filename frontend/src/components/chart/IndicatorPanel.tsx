type Props = {
  selected: string[]
  onToggle: (name: string) => void
}

const indicators = ['MA', 'MACD', 'RSI']

export default function IndicatorPanel({ selected, onToggle }: Props) {
  return (
    <div className="indicator-panel">
      <h3>Indicators</h3>
      <div className="indicator-grid">
        {indicators.map((name) => {
          const active = selected.includes(name)
          return (
            <button
              key={name}
              className={active ? 'chip chip-active' : 'chip'}
              onClick={() => onToggle(name)}
              type="button"
            >
              {name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
