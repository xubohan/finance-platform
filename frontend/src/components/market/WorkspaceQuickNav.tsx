import type { MouseEvent } from 'react'

const quickLinks = [
  { href: '#workspace-overview', label: '实时数据' },
  { href: '#workspace-chart', label: 'K 线' },
  { href: '#workspace-backtest', label: '回测' },
]

export default function WorkspaceQuickNav() {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault()
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    const targetId = href.slice(1)
    if (!targetId) return
    const targetElement = document.getElementById(targetId)
    if (!targetElement) return
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.history.replaceState(null, '', href)
  }

  return (
    <nav className="workspace-quick-nav" aria-label="工作区快捷跳转">
      {quickLinks.map((link) => (
        <a
          key={link.href}
          className="workspace-quick-link"
          href={link.href}
          onClick={(event) => handleClick(event, link.href)}
        >
          {link.label}
        </a>
      ))}
    </nav>
  )
}
