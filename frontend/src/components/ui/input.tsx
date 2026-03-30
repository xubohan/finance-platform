import * as React from 'react'

import { cn } from '../../lib/utils'

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
  return <input className={cn('ui-input', className)} ref={ref} {...props} />
})

Input.displayName = 'Input'

export { Input }
