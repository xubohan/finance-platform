import type { CandlestickData, Time } from 'lightweight-charts'
import { useMemo, useState } from 'react'

import IndicatorPanel from '../components/chart/IndicatorPanel'
import KlineChart from '../components/chart/KlineChart'

function buildMockCandles(): CandlestickData[] {
  const arr: CandlestickData[] = []
  let price = 180

  for (let i = 1; i <= 120; i += 1) {
    const date = new Date(2024, 0, i)
    const open = price
    const drift = Math.sin(i / 8) * 1.8 + (i % 7 === 0 ? -2 : 1)
    const close = open + drift
    const high = Math.max(open, close) + 1.2
    const low = Math.min(open, close) - 1.1

    arr.push({
      time: date.toISOString().slice(0, 10) as Time,
      open,
      high,
      low,
      close,
    })
    price = close
  }

  return arr
}

export default function ChartPage() {
  const [selected, setSelected] = useState<string[]>(['MA'])

  const candles = useMemo(() => buildMockCandles(), [])

  const toggle = (name: string) => {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  return (
    <section className="page-card">
      <h2>Kline & Indicators</h2>
      <p style={{ marginBottom: 18 }}>Toggle MA / MACD / RSI overlays and inspect candle trend.</p>

      <IndicatorPanel selected={selected} onToggle={toggle} />
      <KlineChart candles={candles} showMA={selected.includes('MA')} showRSI={selected.includes('RSI')} />
    </section>
  )
}
