const quickLinks = [
  { href: '#workspace-overview', label: '实时数据' },
  { href: '#workspace-chart', label: 'K 线' },
  { href: '#workspace-backtest', label: '回测' },
]

export default function WorkspaceQuickNav() {
  return (
    <nav className="workspace-quick-nav" aria-label="工作区快捷跳转">
      {quickLinks.map((link) => (
        <a key={link.href} className="workspace-quick-link" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  )
}
