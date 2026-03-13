import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
}

const navItems = [
  { to: '/market', label: 'Market Workspace', hint: '搜索、行情、同步、回测' },
]

export default function AppShell({ children }: Props) {
  return (
    <div className="app-root">
      <aside className="side-nav">
        <p className="eyebrow">Finance Platform</p>
        <h1 className="brand">Market Workspace</h1>
        <p className="shell-copy">
          把标的搜索、行情追踪、K 线同步和单标的回测收敛到一个稳定入口，旧实验页不再作为主导航。
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
              <span>{item.label}</span>
              {'hint' in item ? <small className="nav-hint">{item.hint}</small> : null}
            </NavLink>
          ))}
        </nav>
        <div className="shell-note">
          <strong>当前焦点</strong>
          <p>先把金融信息入口做扎实，再围绕本地历史数据做可重复回测。</p>
        </div>
      </aside>
      <main className="page-wrap">{children}</main>
    </div>
  )
}
