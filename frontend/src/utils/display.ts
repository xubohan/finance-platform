const DEFAULT_PLACEHOLDER = '-'

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function displayText(value: unknown, placeholder = DEFAULT_PLACEHOLDER): string {
  if (typeof value === 'string') {
    const out = value.trim()
    return out.length > 0 ? out : placeholder
  }
  if (value === null || value === undefined) return placeholder
  const out = String(value).trim()
  return out.length > 0 ? out : placeholder
}

export function displayFixed(value: unknown, digits = 2, placeholder = DEFAULT_PLACEHOLDER): string {
  const num = toFiniteNumber(value)
  if (num === null) return placeholder
  return num.toFixed(digits)
}

export function displayPercent(value: unknown, digits = 2, placeholder = DEFAULT_PLACEHOLDER): string {
  const out = displayFixed(value, digits, placeholder)
  return out === placeholder ? placeholder : `${out}%`
}

export function displayLocaleNumber(value: unknown, placeholder = DEFAULT_PLACEHOLDER): string {
  const num = toFiniteNumber(value)
  if (num === null) return placeholder
  return num.toLocaleString()
}
