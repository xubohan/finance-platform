import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import AppShell from './components/layout/AppShell'

type RoutePageModule = { default: ComponentType }

const MissingPage: ComponentType = () => (
  <section className="page-grid">
    <article className="panel">
      <h2>Page Loading</h2>
      <p className="section-copy">This route will be enabled when its page module is merged.</p>
    </article>
  </section>
)

function loadPage(
  loaders: Record<string, () => Promise<RoutePageModule>>,
  fallback: ComponentType = MissingPage,
): ComponentType | LazyExoticComponent<ComponentType> {
  const [loader] = Object.values(loaders)
  if (!loader) return fallback
  return lazy(loader)
}

const DashboardPage = loadPage(import.meta.glob<RoutePageModule>('./pages/Dashboard.tsx'))
const WorkspacePage = loadPage(import.meta.glob<RoutePageModule>('./pages/Market.tsx'))
const MarketDetailPage = loadPage(import.meta.glob<RoutePageModule>('./pages/MarketDetail.tsx'))
const NewsCenterPage = loadPage(import.meta.glob<RoutePageModule>('./pages/NewsCenter.tsx'))
const EventsPage = loadPage(import.meta.glob<RoutePageModule>('./pages/EventsCenter.tsx'))
const BacktestWorkbenchPage = loadPage(import.meta.glob<RoutePageModule>('./pages/BacktestWorkbench.tsx'), DashboardPage as ComponentType)
const ScreenerPage = loadPage(import.meta.glob<RoutePageModule>('./pages/ScreenerHub.tsx'))

export default function App() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <section className="page-grid">
            <article className="panel">
              <h2>Loading Page</h2>
              <p className="section-copy">Preparing workspace module...</p>
            </article>
          </section>
        }
      >
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/market" element={<Navigate to="/market/AAPL" replace />} />
          <Route path="/market/:symbol" element={<MarketDetailPage />} />
          <Route path="/news" element={<NewsCenterPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/backtest" element={<BacktestWorkbenchPage />} />
          <Route path="/screener" element={<ScreenerPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  )
}
