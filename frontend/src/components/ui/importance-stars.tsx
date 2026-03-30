import { Star } from 'lucide-react'

import { cn } from '../../lib/utils'

type Props = {
  value?: number | null
  max?: number
  className?: string
}

export function ImportanceStars({ value, max = 5, className }: Props) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0

  return (
    <div className={cn('inline-flex items-center gap-1', className)} aria-label={`importance ${safeValue} of ${max}`}>
      {Array.from({ length: max }, (_, index) => (
        <Star
          key={`importance-star-${index + 1}`}
          className={cn(
            'h-3.5 w-3.5',
            index < safeValue ? 'fill-amber-400 text-amber-400' : 'text-slate-300',
          )}
        />
      ))}
    </div>
  )
}
