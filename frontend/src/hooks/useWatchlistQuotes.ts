import { useEffect, useRef, useState } from 'react'

import { extractApiError } from '../api/client'
import { getBatchQuotes, type BatchQuoteRow, type SearchAsset } from '../api/market'

export type WatchlistQuoteRow = SearchAsset & {
  price?: number
  change_pct_24h?: number
  as_of?: string | null
  source?: string
}

export function useWatchlistQuotes(watchlistAssets: SearchAsset[]) {
  const requestIdRef = useRef(0)
  const [rows, setRows] = useState<WatchlistQuoteRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (watchlistAssets.length === 0) {
      setRows([])
      setError(null)
      setLoading(false)
      return
    }

    let active = true

    const loadQuotes = async () => {
      setLoading(true)
      setError(null)
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId

      try {
        const resp = await getBatchQuotes(watchlistAssets.map((asset) => asset.symbol))
        if (!active || requestIdRef.current !== requestId) return

        const quoteMap = new Map<string, BatchQuoteRow>()
        resp.data.forEach((row) => {
          quoteMap.set(row.symbol, row)
        })

        const nextRows = watchlistAssets.map((asset) => {
          const row = quoteMap.get(asset.symbol)
          return {
            ...asset,
            price: row?.price ?? undefined,
            change_pct_24h: row?.change_pct_24h ?? undefined,
            as_of: row?.as_of ?? undefined,
            source: row?.source ?? undefined,
          }
        })

        const failedRows = resp.data.filter((row) => row.error)
        setRows(nextRows)
        setError(failedRows[0]?.error ?? null)
      } catch (error) {
        if (!active || requestIdRef.current !== requestId) return
        setRows(watchlistAssets.map((asset) => ({ ...asset })))
        setError(extractApiError(error, '部分自选标的快照加载失败'))
      } finally {
        if (active && requestIdRef.current === requestId) {
          setLoading(false)
        }
      }
    }

    void loadQuotes()
    const timer = window.setInterval(() => {
      void loadQuotes()
    }, 60000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [watchlistAssets])

  return {
    rows,
    loading,
    error,
  }
}
