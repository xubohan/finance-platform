import {
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useRef } from 'react'

import { recordFrontendMetric } from '../../utils/runtimePerformance'

export type OscillatorMode = 'none' | 'MACD' | 'KDJ' | 'RSI'

export type KlineMarker = {
  time: Time
  text: string
  color: string
  shape?: 'circle' | 'square' | 'arrowUp' | 'arrowDown'
  position?: 'aboveBar' | 'belowBar' | 'inBar'
}

type Props = {
  candles: CandlestickData[]
  showMA?: boolean
  showEMA?: boolean
  showBOLL?: boolean
  showRSI?: boolean
  oscillator?: OscillatorMode
  markers?: KlineMarker[]
  height?: number
  secondaryHeight?: number
}

function calcMA(candles: CandlestickData[], window = 10): LineData[] {
  const out: LineData[] = []
  for (let i = window - 1; i < candles.length; i += 1) {
    const slice = candles.slice(i - window + 1, i + 1)
    const avg = slice.reduce((sum, candle) => sum + candle.close, 0) / window
    out.push({ time: candles[i].time, value: avg })
  }
  return out
}

function calcEMA(candles: CandlestickData[], period = 10): LineData[] {
  if (candles.length === 0) return []
  const multiplier = 2 / (period + 1)
  let ema = candles[0].close
  return candles.map((candle) => {
    ema = (candle.close - ema) * multiplier + ema
    return { time: candle.time, value: ema }
  })
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

function calcBollinger(candles: CandlestickData[], period = 20, multiplier = 2) {
  const upper: LineData[] = []
  const lower: LineData[] = []
  for (let i = period - 1; i < candles.length; i += 1) {
    const slice = candles.slice(i - period + 1, i + 1)
    const avg = slice.reduce((sum, candle) => sum + candle.close, 0) / period
    const variance = slice.reduce((sum, candle) => sum + (candle.close - avg) ** 2, 0) / period
    const deviation = Math.sqrt(variance)
    upper.push({ time: candles[i].time, value: avg + deviation * multiplier })
    lower.push({ time: candles[i].time, value: avg - deviation * multiplier })
  }
  return { upper, lower }
}

function calcMacd(candles: CandlestickData[]) {
  if (candles.length === 0) {
    return { macd: [] as LineData[], signal: [] as LineData[], histogram: [] as HistogramData[] }
  }
  const fast = calcEMA(candles, 12)
  const slow = calcEMA(candles, 26)
  const macdRaw = candles.map((candle, index) => ({
    time: candle.time,
    value: (fast[index]?.value ?? 0) - (slow[index]?.value ?? 0),
  }))

  const signal: LineData[] = []
  const histogram: HistogramData[] = []
  const smoothing = 2 / (9 + 1)
  let signalValue = macdRaw[0]?.value ?? 0
  macdRaw.forEach((point) => {
    signalValue = (point.value - signalValue) * smoothing + signalValue
    signal.push({ time: point.time, value: signalValue })
    const histValue = point.value - signalValue
    histogram.push({
      time: point.time,
      value: histValue,
      color: histValue >= 0 ? 'rgba(30, 170, 122, 0.6)' : 'rgba(214, 69, 69, 0.6)',
    })
  })
  return { macd: macdRaw, signal, histogram }
}

function calcKdj(candles: CandlestickData[], period = 9) {
  const k: LineData[] = []
  const d: LineData[] = []
  const j: LineData[] = []
  let kValue = 50
  let dValue = 50
  for (let i = 0; i < candles.length; i += 1) {
    const slice = candles.slice(Math.max(0, i - period + 1), i + 1)
    const highest = Math.max(...slice.map((item) => item.high))
    const lowest = Math.min(...slice.map((item) => item.low))
    const current = candles[i]
    const denominator = highest - lowest
    const rsv = denominator === 0 ? 50 : ((current.close - lowest) / denominator) * 100
    kValue = (2 / 3) * kValue + (1 / 3) * rsv
    dValue = (2 / 3) * dValue + (1 / 3) * kValue
    const jValue = 3 * kValue - 2 * dValue
    k.push({ time: current.time, value: kValue })
    d.push({ time: current.time, value: dValue })
    j.push({ time: current.time, value: jValue })
  }
  return { k, d, j }
}

export default function KlineChart({
  candles,
  showMA = false,
  showEMA = false,
  showBOLL = false,
  showRSI = false,
  oscillator,
  markers = [],
  height = 420,
  secondaryHeight = 160,
}: Props) {
  const activeOscillator = useMemo<OscillatorMode>(() => {
    if (oscillator) return oscillator
    if (showRSI) return 'RSI'
    return 'none'
  }, [oscillator, showRSI])

  const mainContainerRef = useRef<HTMLDivElement | null>(null)
  const secondaryContainerRef = useRef<HTMLDivElement | null>(null)

  const mainChartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const maSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bollUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bollLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  const secondaryChartRef = useRef<IChartApi | null>(null)
  const secondaryLineARef = useRef<ISeriesApi<'Line'> | null>(null)
  const secondaryLineBRef = useRef<ISeriesApi<'Line'> | null>(null)
  const secondaryLineCRef = useRef<ISeriesApi<'Line'> | null>(null)
  const secondaryHistogramRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  const hasFittedMainRef = useRef(false)
  const hasFittedSecondaryRef = useRef(false)

  useEffect(() => {
    if (!mainContainerRef.current) return

    const started = performance.now()
    const chart = createChart(mainContainerRef.current, {
      height,
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
      crosshair: { mode: 0 },
    })
    recordFrontendMetric('chart.kline.init', performance.now() - started, { category: 'render' })

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#1eaa7a',
      downColor: '#d64545',
      borderUpColor: '#1eaa7a',
      borderDownColor: '#d64545',
      wickUpColor: '#1eaa7a',
      wickDownColor: '#d64545',
    })
    const maSeries = chart.addLineSeries({ color: '#0f89c9', lineWidth: 2 })
    const emaSeries = chart.addLineSeries({ color: '#7d53de', lineWidth: 2 })
    const bollUpperSeries = chart.addLineSeries({ color: '#f5a623', lineWidth: 1 })
    const bollLowerSeries = chart.addLineSeries({ color: '#f5a623', lineWidth: 1 })

    mainChartRef.current = chart
    candleSeriesRef.current = candleSeries
    maSeriesRef.current = maSeries
    emaSeriesRef.current = emaSeries
    bollUpperSeriesRef.current = bollUpperSeries
    bollLowerSeriesRef.current = bollLowerSeries

    const onResize = () => {
      if (!mainContainerRef.current) return
      chart.applyOptions({ width: mainContainerRef.current.clientWidth })
    }
    onResize()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      mainChartRef.current = null
      candleSeriesRef.current = null
      maSeriesRef.current = null
      emaSeriesRef.current = null
      bollUpperSeriesRef.current = null
      bollLowerSeriesRef.current = null
      hasFittedMainRef.current = false
    }
  }, [height])

  useEffect(() => {
    if (activeOscillator === 'none') {
      secondaryChartRef.current?.remove()
      secondaryChartRef.current = null
      secondaryLineARef.current = null
      secondaryLineBRef.current = null
      secondaryLineCRef.current = null
      secondaryHistogramRef.current = null
      hasFittedSecondaryRef.current = false
      return
    }
    if (!secondaryContainerRef.current) return

    const chart = createChart(secondaryContainerRef.current, {
      height: secondaryHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: '#385d88',
      },
      grid: {
        vertLines: { color: 'rgba(47, 76, 113, 0.08)' },
        horzLines: { color: 'rgba(47, 76, 113, 0.08)' },
      },
      rightPriceScale: { borderColor: 'rgba(47, 76, 113, 0.12)' },
      timeScale: { borderColor: 'rgba(47, 76, 113, 0.12)' },
      crosshair: { mode: 0 },
    })
    const lineA = chart.addLineSeries({ color: '#087f8c', lineWidth: 2 })
    const lineB = chart.addLineSeries({ color: '#f39c12', lineWidth: 2 })
    const lineC = chart.addLineSeries({ color: '#ad1457', lineWidth: 2 })
    const histogram = chart.addHistogramSeries({
      priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
      base: 0,
    })

    secondaryChartRef.current = chart
    secondaryLineARef.current = lineA
    secondaryLineBRef.current = lineB
    secondaryLineCRef.current = lineC
    secondaryHistogramRef.current = histogram

    const onResize = () => {
      if (!secondaryContainerRef.current) return
      chart.applyOptions({ width: secondaryContainerRef.current.clientWidth })
    }
    onResize()
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      secondaryChartRef.current = null
      secondaryLineARef.current = null
      secondaryLineBRef.current = null
      secondaryLineCRef.current = null
      secondaryHistogramRef.current = null
      hasFittedSecondaryRef.current = false
    }
  }, [activeOscillator, secondaryHeight])

  useEffect(() => {
    if (!candleSeriesRef.current || !mainChartRef.current) return
    const started = performance.now()
    candleSeriesRef.current.setData(candles)

    const markerPayload: SeriesMarker<Time>[] = markers.map((item) => ({
      time: item.time,
      position: item.position ?? 'aboveBar',
      color: item.color,
      shape: item.shape ?? 'circle',
      text: item.text,
    }))
    candleSeriesRef.current.setMarkers(markerPayload)

    if (candles.length > 0 && !hasFittedMainRef.current) {
      mainChartRef.current.timeScale().fitContent()
      hasFittedMainRef.current = true
    }
    if (candles.length === 0) {
      hasFittedMainRef.current = false
    }
    recordFrontendMetric('chart.kline.render', performance.now() - started, { category: 'render' })
  }, [candles, markers])

  useEffect(() => {
    if (!maSeriesRef.current || !emaSeriesRef.current || !bollUpperSeriesRef.current || !bollLowerSeriesRef.current) return
    maSeriesRef.current.setData(showMA ? calcMA(candles) : [])
    emaSeriesRef.current.setData(showEMA ? calcEMA(candles) : [])
    const boll = showBOLL ? calcBollinger(candles) : { upper: [], lower: [] }
    bollUpperSeriesRef.current.setData(boll.upper)
    bollLowerSeriesRef.current.setData(boll.lower)
  }, [candles, showBOLL, showEMA, showMA])

  useEffect(() => {
    if (!secondaryLineARef.current || !secondaryLineBRef.current || !secondaryLineCRef.current || !secondaryHistogramRef.current) return

    secondaryLineARef.current.setData([])
    secondaryLineBRef.current.setData([])
    secondaryLineCRef.current.setData([])
    secondaryHistogramRef.current.setData([])

    if (activeOscillator === 'MACD') {
      const macd = calcMacd(candles)
      secondaryLineARef.current.setData(macd.macd)
      secondaryLineBRef.current.setData(macd.signal)
      secondaryHistogramRef.current.setData(macd.histogram)
    } else if (activeOscillator === 'KDJ') {
      const kdj = calcKdj(candles)
      secondaryLineARef.current.setData(kdj.k)
      secondaryLineBRef.current.setData(kdj.d)
      secondaryLineCRef.current.setData(kdj.j)
    } else if (activeOscillator === 'RSI') {
      secondaryLineARef.current.setData(calcRSI(candles))
    }

    if (secondaryChartRef.current && candles.length > 0 && !hasFittedSecondaryRef.current) {
      secondaryChartRef.current.timeScale().fitContent()
      hasFittedSecondaryRef.current = true
    }
    if (candles.length === 0) {
      hasFittedSecondaryRef.current = false
    }
  }, [activeOscillator, candles])

  return (
    <div style={{ width: '100%', display: 'grid', gap: 10 }}>
      <div ref={mainContainerRef} style={{ width: '100%' }} />
      {activeOscillator !== 'none' ? <div ref={secondaryContainerRef} style={{ width: '100%' }} /> : null}
    </div>
  )
}
