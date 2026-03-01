import { Navigate, Route, Routes } from 'react-router-dom'

import AppShell from './components/layout/AppShell'
import AIAnalysisPage from './pages/AIAnalysis'
import BacktestPage from './pages/Backtest'
import ChartPage from './pages/Chart'
import FactorsPage from './pages/Factors'
import MarketPage from './pages/Market'
import ScreenerPage from './pages/Screener'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/market" replace />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/chart" element={<ChartPage />} />
        <Route path="/screener" element={<ScreenerPage />} />
        <Route path="/factors" element={<FactorsPage />} />
        <Route path="/backtest" element={<BacktestPage />} />
        <Route path="/ai" element={<AIAnalysisPage />} />
      </Routes>
    </AppShell>
  )
}
