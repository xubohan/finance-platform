import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        primary:
          'bg-slate-950 text-white shadow-lg hover:-translate-y-0.5 hover:bg-slate-900 hover:shadow-xl',
        secondary:
          'border border-slate-200 bg-white/85 text-slate-900 hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-cyan-50/70',
        ghost: 'text-slate-600 hover:bg-slate-900/5 hover:text-slate-950',
        chip: 'border border-slate-200 bg-white/70 text-slate-700 hover:border-cyan-200 hover:bg-cyan-50',
      },
      size: {
        sm: 'h-9 px-3.5',
        md: 'h-11 px-5',
        lg: 'h-12 px-6',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

export function Button({ className, variant, size, asChild = false, ...props }: Props) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
