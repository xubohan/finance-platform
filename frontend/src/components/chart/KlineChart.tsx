import { createChart, type CandlestickData, type IChartApi, type ISeriesApi, type LineData } from 'lightweight-charts'
import { useEffect, useRef } from 'react'

type Props = {
  candles: CandlestickData[]
  showMA: boolean
  showRSI: boolean
}

function calcMA(candles: CandlestickData[], window = 10): LineData[] {
  const out: LineData[] = []
  for (let i = window - 1; i < candles.length; i += 1) {
    const slice = candles.slice(i - window + 1, i + 1)
    const avg = slice.reduce((sum, c) => sum + c.close, 0) / window
    out.push({ time: candles[i].time, value: avg })
  }
  return out
}

function calcRSI(candles: CandlestickData[], period = 14): LineData[] {
  if (candles.length <= period) return []

  const gains: number[] = []
  const losses: number[] = []
  for (let i = 1; i < candles.length; i += 1) {
    const diff = candles[i].close - candles[i - 1].close
    gains.push(Math.max(diff, 0))
    losses.push(Math.max(-diff, 0))
  }

  const out: LineData[] = []
  for (let i = period; i < gains.length; i += 1) {
    const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period
    const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs)
    out.push({ time: candles[i].time, value: rsi })
  }
  return out
}

export default function KlineChart({ candles, showMA, showRSI }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const maSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      height: 420,
      layout: {
        background: { color: 'transparent' },
        textColor: '#2f4c71',
      },
      grid: {
        vertLines: { color: 'rgba(47, 76, 113, 0.09)' },
        horzLines: { color: 'rgba(47, 76, 113, 0.09)' },
      },
      rightPriceScale: { borderColor: 'rgba(47, 76, 113, 0.15)' },
      timeScale: { borderColor: 'rgba(47, 76, 113, 0.15)' },
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#1eaa7a',
      downColor: '#d64545',
      borderUpColor: '#1eaa7a',
      borderDownColor: '#d64545',
      wickUpColor: '#1eaa7a',
      wickDownColor: '#d64545',
    })
    candleSeries.setData(candles)

    const maSeries = chart.addLineSeries({ color: '#0f89c9', lineWidth: 2 })
    const rsiSeries = chart.addLineSeries({ color: '#f08326', lineWidth: 2 })

    maSeriesRef.current = maSeries
    rsiSeriesRef.current = rsiSeries
    chartRef.current = chart

    const onResize = () => {
      if (!containerRef.current) return
      chart.applyOptions({ width: containerRef.current.clientWidth })
    }
    onResize()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
    }
  }, [candles])

  useEffect(() => {
    if (!maSeriesRef.current || !rsiSeriesRef.current) return

    maSeriesRef.current.setData(showMA ? calcMA(candles) : [])
    rsiSeriesRef.current.setData(showRSI ? calcRSI(candles) : [])
  }, [candles, showMA, showRSI])

  return <div ref={containerRef} style={{ width: '100%' }} />
}
