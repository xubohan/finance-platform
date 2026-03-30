import type { HTMLAttributes } from 'react'

import { cn } from '../../lib/utils'

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: 'default' | 'positive' | 'negative' | 'warning' | 'muted'
}

const toneMap: Record<NonNullable<Props['tone']>, string> = {
  default: 'border-slate-200 bg-white/75 text-slate-700',
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  negative: 'border-rose-200 bg-rose-50 text-rose-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  muted: 'border-slate-200 bg-slate-100/80 text-slate-500',
}

export function Badge({ className, tone = 'default', ...props }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-widest',
        toneMap[tone],
        className,
      )}
      {...props}
    />
  )
}
