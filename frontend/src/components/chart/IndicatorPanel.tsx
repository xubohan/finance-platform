type Props = {
  selected: string[]
  onToggle: (name: string) => void
  options?: string[]
  title?: string
}

const DEFAULT_INDICATORS = ['MA', 'EMA', 'BOLL', 'RSI']

export default function IndicatorPanel({ selected, onToggle, options = DEFAULT_INDICATORS, title = 'Indicators' }: Props) {
  return (
    <div className="indicator-panel">
      <h3>{title}</h3>
      <div className="indicator-grid">
        {options.map((name) => {
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
