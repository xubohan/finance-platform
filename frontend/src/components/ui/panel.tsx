import * as React from 'react'

import { cn } from '../../lib/utils'

type PanelProps = React.HTMLAttributes<HTMLDivElement>

function Panel({ className, ...props }: PanelProps) {
  return <section className={cn('ui-panel', className)} {...props} />
}

function PanelHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <header className={cn('ui-panel-header', className)} {...props} />
}

function PanelTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('ui-panel-title', className)} {...props} />
}

function PanelDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('ui-panel-description', className)} {...props} />
}

function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ui-panel-body', className)} {...props} />
}

export { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle }
