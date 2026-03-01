import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
}

const navItems = [
  { to: '/market', label: 'Market' },
  { to: '/chart', label: 'Chart' },
  { to: '/screener', label: 'Screener' },
  { to: '/factors', label: 'Factors' },
  { to: '/backtest', label: 'Backtest' },
  { to: '/ai', label: 'AI Analysis' },
]

export default function AppShell({ children }: Props) {
  return (
    <div className="app-root">
      <aside className="side-nav">
        <h1 className="brand">Finance Terminal</h1>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'nav-link nav-link-active' : 'nav-link'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="page-wrap">{children}</main>
    </div>
  )
}
