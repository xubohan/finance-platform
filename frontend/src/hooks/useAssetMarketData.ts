import { useEffect, useRef, useState } from 'react'
import type { CandlestickData } from 'lightweight-charts'

import { extractApiError } from '../api/client'
import {
  getKline,
  getMarketSummary,
  syncHistory,
  toCandles,
  type HistoryStatusData,
  type KlineResponse,
  type MarketPeriod,
  type QuoteData,
  type QuoteResponse,
  type SearchAsset,
} from '../api/market'

type MarketMeta = {
  quote?: QuoteResponse['meta']
  kline?: KlineResponse['meta']
}

type Args = {
  selectedAsset: SearchAsset
  period: MarketPeriod
  chartStartDate: string
  chartEndDate: string
}

export function useAssetMarketData({ selectedAsset, period, chartStartDate, chartEndDate }: Args) {
  const selectedAssetRef = useRef(selectedAsset)
  const syncRequestIdRef = useRef(0)
  const [quote, setQuote] = useState<QuoteData | null>(null)
  const [candles, setCandles] = useState<CandlestickData[]>([])
  const [marketMeta, setMarketMeta] = useState<MarketMeta>({})
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [klineError, setKlineError] = useState<string | null>(null)
  const [loadingQuote, setLoadingQuote] = useState(false)
  const [loadingKline, setLoadingKline] = useState(false)
  const [chartRefreshKey, setChartRefreshKey] = useState(0)
  const [historyStatus, setHistoryStatus] = useState<HistoryStatusData | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [syncingHistory, setSyncingHistory] = useState(false)

  useEffect(() => {
    selectedAssetRef.current = selectedAsset
  }, [selectedAsset])

  useEffect(() => {
    if (!selectedAsset.symbol) return

    let active = true
    const quoteRefreshMs = selectedAsset.asset_type === 'crypto' ? 30000 : 60000

    const loadSummary = async () => {
      setLoadingQuote(true)
      setLoadingHistory(true)
      setHistoryError(null)
      try {
        const resp = await getMarketSummary(selectedAsset.symbol)
        if (!active) return
        setQuote(resp.data?.quote ?? null)
        setHistoryStatus(resp.data?.history_status ?? null)
        setMarketMeta((prev) => ({ ...prev, quote: resp.meta?.quote }))
        setQuoteError(resp.meta?.quote_error ?? null)
      } catch (error) {
        if (!active) return
        setQuote(null)
        setQuoteError(extractApiError(error, '加载报价失败'))
        setHistoryStatus(null)
        setHistoryError(extractApiError(error, '加载本地历史状态失败'))
      } finally {
        if (active) {
          setLoadingQuote(false)
          setLoadingHistory(false)
        }
      }
    }

    void loadSummary()
    const timer = window.setInterval(() => {
      void loadSummary()
    }, quoteRefreshMs)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [selectedAsset.asset_type, selectedAsset.symbol])

  useEffect(() => {
    if (!selectedAsset.symbol) return
    if (chartStartDate > chartEndDate) {
      setCandles([])
      setKlineError('K 线开始日期必须早于结束日期')
      return
    }

    let active = true

    const loadKline = async () => {
      setLoadingKline(true)
      try {
        const resp = await getKline(selectedAsset.symbol, period, chartStartDate, chartEndDate)
        if (!active) return
        setCandles(toCandles(resp.data ?? []))
        setMarketMeta((prev) => ({ ...prev, kline: resp.meta }))
        setKlineError(null)
      } catch (error) {
        if (!active) return
        setCandles([])
        setKlineError(extractApiError(error, '加载 K 线失败'))
      } finally {
        if (active) {
          setLoadingKline(false)
        }
      }
    }

    void loadKline()

    return () => {
      active = false
    }
  }, [chartEndDate, chartRefreshKey, chartStartDate, period, selectedAsset.symbol])

  const refreshChart = () => {
    setChartRefreshKey((value) => value + 1)
  }

  const syncHistoryNow = async () => {
    if (chartStartDate > chartEndDate) {
      setHistoryError('同步开始日期必须早于结束日期')
      return
    }

    setSyncingHistory(true)
    setHistoryError(null)
    const requestId = syncRequestIdRef.current + 1
    syncRequestIdRef.current = requestId
    const requestSymbol = selectedAsset.symbol
    const requestAssetType = selectedAsset.asset_type
    try {
      const resp = await syncHistory(requestSymbol, chartStartDate, chartEndDate)
      if (
        selectedAssetRef.current.symbol !== requestSymbol ||
        selectedAssetRef.current.asset_type !== requestAssetType
      ) {
        return
      }
      setHistoryStatus(
        resp.data
          ? {
              symbol: resp.data.symbol,
              asset_type: resp.data.asset_type,
              local_rows: resp.data.local_rows,
              local_start: resp.data.local_start,
              local_end: resp.data.local_end,
              has_data: resp.data.local_rows > 0,
            }
          : null,
      )
      refreshChart()
    } catch (error) {
      if (
        selectedAssetRef.current.symbol !== requestSymbol ||
        selectedAssetRef.current.asset_type !== requestAssetType
      ) {
        return
      }
      setHistoryError(extractApiError(error, '同步本地历史失败'))
    } finally {
      if (syncRequestIdRef.current === requestId) {
        setSyncingHistory(false)
      }
    }
  }

  const quoteSource = marketMeta.quote?.source ?? marketMeta.quote?.fetch_source
  const klineSource = marketMeta.kline?.source ?? marketMeta.kline?.fetch_source
  const marketError = quoteError ?? klineError
  const chartStateText =
    loadingKline ? '正在同步并加载 K 线...' : candles.length === 0 ? '当前区间没有可展示的 K 线。' : null

  return {
    quote,
    candles,
    marketMeta,
    marketError,
    loadingQuote,
    loadingKline,
    historyStatus,
    historyError,
    loadingHistory,
    syncingHistory,
    refreshChart,
    syncHistoryNow,
    quoteSource,
    klineSource,
    chartStateText,
  }
}
