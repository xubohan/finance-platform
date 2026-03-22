import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
}

function MarketIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 18.5h16M6 16l3.2-4.2 3.1 2.6L17.5 7 20 9.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="10.5"
        cy="10.5"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M14.8 14.8 19 19"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

const navItems = [
  { to: '/market', label: 'Market Workspace', icon: <MarketIcon />, hint: '搜索、行情、同步、回测' },
  { to: '/screener', label: 'Market Screener', icon: <SearchIcon />, hint: 'Filter and discover assets' },
]

export default function AppShell({ children }: Props) {
  return (
    <div className="app-root">
      <aside className="side-nav">
        <p className="eyebrow">Finance Platform</p>
        <h1 className="brand">Market Workspace</h1>
        <p className="shell-copy">
          把单标的工作台和全市场筛选页收敛成两个稳定入口，避免旧实验页继续占据主导航。
        </p>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'nav-link nav-link-active' : 'nav-link'
              }
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-copy">
                <span>{item.label}</span>
                {'hint' in item ? <small className="nav-hint">{item.hint}</small> : null}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="shell-note">
          <strong>当前焦点</strong>
          <p>先把金融信息入口做扎实，再把发现路径和单标的分析路径彻底接起来。</p>
        </div>
      </aside>
      <main className="page-wrap">{children}</main>
    </div>
  )
}
