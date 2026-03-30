import { createChart, type IChartApi, type ISeriesApi, type LineData } from 'lightweight-charts'
import { useEffect, useRef } from 'react'

import { recordFrontendMetric } from '../../utils/runtimePerformance'

type Point = {
  date: string
  value: number
}

type CurveSeries = {
  id: string
  label?: string
  color?: string
  lineWidth?: number
  points: Point[]
}

type Props = {
  points?: Point[]
  series?: CurveSeries[]
  height?: number
}

const DEFAULT_SERIES_COLORS = ['#0f89c9', '#f97316', '#10b981', '#a855f7', '#ef4444']

export default function EquityCurve({ points = [], series, height = 280 }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const linesRef = useRef<Array<ISeriesApi<'Line'>>>([])
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

    chartRef.current = chart
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
      linesRef.current = []
      hasFittedRef.current = false
    }
  }, [height])

  useEffect(() => {
    if (!chartRef.current) return
    const started = performance.now()
    const chart = chartRef.current
    const resolvedSeries =
      series && series.length > 0
        ? series
        : [
            {
              id: 'equity',
              color: DEFAULT_SERIES_COLORS[0],
              lineWidth: 2,
              points,
            },
          ]

    linesRef.current.forEach((line) => {
      chart.removeSeries(line)
    })
    linesRef.current = resolvedSeries.map((item, index) =>
      chart.addLineSeries({
        color: item.color ?? DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length],
        lineWidth: item.lineWidth ?? 2,
      }),
    )

    const hasAnyData = resolvedSeries.some((item, index) => {
      const lineData: LineData[] = item.points.map((point) => ({
        time: point.date,
        value: point.value,
      }))
      linesRef.current[index]?.setData(lineData)
      return lineData.length > 0
    })

    if (hasAnyData && !hasFittedRef.current) {
      chartRef.current?.timeScale().fitContent()
      hasFittedRef.current = true
    }
    if (!hasAnyData) {
      hasFittedRef.current = false
    }
    recordFrontendMetric('chart.equity.render', performance.now() - started, { category: 'render' })
  }, [points, series])

  return <div ref={ref} style={{ width: '100%' }} />
}
