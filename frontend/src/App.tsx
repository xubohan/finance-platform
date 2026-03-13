import { Navigate, Route, Routes } from 'react-router-dom'

import AppShell from './components/layout/AppShell'
import MarketPage from './pages/Market'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/market" replace />} />
        <Route path="/market" element={<MarketPage />} />
        <Route path="/chart" element={<Navigate to="/market" replace />} />
        <Route path="/screener" element={<Navigate to="/market" replace />} />
        <Route path="/factors" element={<Navigate to="/market" replace />} />
        <Route path="/backtest" element={<Navigate to="/market" replace />} />
        <Route path="/ai" element={<Navigate to="/market" replace />} />
        <Route path="*" element={<Navigate to="/market" replace />} />
      </Routes>
    </AppShell>
  )
}
