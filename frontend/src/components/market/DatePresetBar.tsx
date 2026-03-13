type DatePreset = {
  label: string
  value: string
}

type Props = {
  presets: DatePreset[]
  onSelect: (value: string) => void
}

export default function DatePresetBar({ presets, onSelect }: Props) {
  return (
    <div className="preset-bar">
      {presets.map((preset) => (
        <button
          key={preset.value}
          className="chip"
          type="button"
          onClick={() => onSelect(preset.value)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
