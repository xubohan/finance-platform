import { createChart, type IChartApi, type ISeriesApi, type LineData } from 'lightweight-charts'
import { useEffect, useRef } from 'react'

import { recordFrontendMetric } from '../../utils/runtimePerformance'

type Point = {
  date: string
  value: number
}

type Props = {
  points: Point[]
  height?: number
}

export default function EquityCurve({ points, height = 280 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const lineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const hasFittedRef = useRef(false)

  useEffect(() => {
    if (!ref.current) return

    const started = performance.now()
    const chart = createChart(ref.current, {
      height,
      layout: { background: { color: 'transparent' }, textColor: '#2f4c71' },
      grid: {
        vertLines: { color: 'rgba(47, 76, 113, 0.09)' },
        horzLines: { color: 'rgba(47, 76, 113, 0.09)' },
      },
    })

    const line = chart.addLineSeries({ color: '#0f89c9', lineWidth: 2 })
    chartRef.current = chart
    lineRef.current = line
    recordFrontendMetric('chart.equity.init', performance.now() - started, { category: 'render' })
    const onResize = () => {
      if (!ref.current) return
      chart.applyOptions({ width: ref.current.clientWidth })
    }
    onResize()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      chartRef.current = null
      lineRef.current = null
      hasFittedRef.current = false
    }
  }, [height])

  useEffect(() => {
    if (!lineRef.current) return
    const started = performance.now()
    const lineData: LineData[] = points.map((p) => ({
      time: p.date,
      value: p.value,
    }))
    lineRef.current.setData(lineData)
    if (lineData.length > 0 && !hasFittedRef.current) {
      chartRef.current?.timeScale().fitContent()
      hasFittedRef.current = true
    }
    if (lineData.length === 0) {
      hasFittedRef.current = false
    }
    recordFrontendMetric('chart.equity.render', performance.now() - started, { category: 'render' })
  }, [points])

  return <div ref={ref} style={{ width: '100%' }} />
}
