export function toDateInputLocal(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function daysAgo(days: number): string {
  const value = new Date()
  value.setDate(value.getDate() - days)
  return toDateInputLocal(value)
}

export function yearsAgo(years: number): string {
  const now = new Date()
  const targetYear = now.getFullYear() - years
  const month = now.getMonth()
  const day = now.getDate()
  const maxDay = new Date(targetYear, month + 1, 0).getDate()
  return toDateInputLocal(new Date(targetYear, month, Math.min(day, maxDay)))
}

export function yearStart(): string {
  const value = new Date()
  return `${value.getFullYear()}-01-01`
}

export function formatAsOf(value?: string | null): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}
