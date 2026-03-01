import { createChart, type LineData } from 'lightweight-charts'
import { useEffect, useRef } from 'react'

type Point = {
  date: string
  value: number
}

type Props = {
  points: Point[]
}

export default function EquityCurve({ points }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!ref.current) return

    const chart = createChart(ref.current, {
      height: 280,
      layout: { background: { color: 'transparent' }, textColor: '#2f4c71' },
      grid: {
        vertLines: { color: 'rgba(47, 76, 113, 0.09)' },
        horzLines: { color: 'rgba(47, 76, 113, 0.09)' },
      },
    })

    const line = chart.addLineSeries({ color: '#0f89c9', lineWidth: 2 })
    const lineData: LineData[] = points.map((p) => ({
      time: p.date,
      value: p.value,
    }))
    line.setData(lineData)

    chart.timeScale().fitContent()
    chart.applyOptions({ width: ref.current.clientWidth })

    return () => chart.remove()
  }, [points])

  return <div ref={ref} style={{ width: '100%' }} />
}
