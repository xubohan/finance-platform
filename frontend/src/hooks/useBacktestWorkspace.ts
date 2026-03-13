import { useRef, useState } from 'react'

import {
  runBacktest,
  type BacktestRunData,
  type BacktestRunMeta,
} from '../api/backtest'
import { extractApiError } from '../api/client'
import type { SearchAsset } from '../api/market'
import { downloadFile } from '../utils/download'

type StrategyName = 'ma_cross' | 'macd_signal' | 'rsi_reversal'

type Args = {
  selectedAsset: SearchAsset
  strategyName: StrategyName
  fast: number
  slow: number
  rsiPeriod: number
  oversold: number
  overbought: number
  initialCapital: number
  backtestStartDate: string
  backtestEndDate: string
  syncIfMissing: boolean
}

export function useBacktestWorkspace({
  selectedAsset,
  strategyName,
  fast,
  slow,
  rsiPeriod,
  oversold,
  overbought,
  initialCapital,
  backtestStartDate,
  backtestEndDate,
  syncIfMissing,
}: Args) {
  const selectedAssetRef = useRef(selectedAsset)
  const requestIdRef = useRef(0)
  const [loadingBacktest, setLoadingBacktest] = useState(false)
  const [backtestError, setBacktestError] = useState<string | null>(null)
  const [backtestResult, setBacktestResult] = useState<BacktestRunData | null>(null)
  const [backtestMeta, setBacktestMeta] = useState<BacktestRunMeta | null>(null)

  selectedAssetRef.current = selectedAsset

  const runBacktestNow = async () => {
    if (backtestStartDate > backtestEndDate) {
      setBacktestError('回测开始日期必须早于结束日期')
      return
    }

    const parameters: Record<string, number> = {}
    if (strategyName === 'ma_cross') {
      parameters.fast = fast
      parameters.slow = slow
    }
    if (strategyName === 'rsi_reversal') {
      parameters.period = rsiPeriod
      parameters.oversold = oversold
      parameters.overbought = overbought
    }

    setLoadingBacktest(true)
    setBacktestError(null)
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const requestSymbol = selectedAsset.symbol
    const requestAssetType = selectedAsset.asset_type
    try {
      const resp = await runBacktest({
        symbol: requestSymbol,
        asset_type: requestAssetType,
        strategy_name: strategyName,
        parameters,
        start_date: backtestStartDate,
        end_date: backtestEndDate,
        initial_capital: initialCapital,
        sync_if_missing: syncIfMissing,
      })
      if (
        selectedAssetRef.current.symbol !== requestSymbol ||
        selectedAssetRef.current.asset_type !== requestAssetType
      ) {
        return
      }
      setBacktestResult(resp.data)
      setBacktestMeta(resp.meta)
    } catch (error) {
      if (
        selectedAssetRef.current.symbol !== requestSymbol ||
        selectedAssetRef.current.asset_type !== requestAssetType
      ) {
        return
      }
      setBacktestResult(null)
      setBacktestMeta(null)
      setBacktestError(extractApiError(error, '运行单标的回测失败'))
    } finally {
      if (requestIdRef.current === requestId) {
        setLoadingBacktest(false)
      }
    }
  }

  const clearBacktestState = () => {
    setBacktestResult(null)
    setBacktestMeta(null)
    setBacktestError(null)
  }

  const exportBacktestJson = () => {
    if (!backtestResult) return
    const payload = {
      asset: selectedAsset,
      request: {
        strategyName,
        backtestStartDate,
        backtestEndDate,
        initialCapital,
        syncIfMissing,
      },
      meta: backtestMeta,
      result: backtestResult,
    }
    downloadFile(
      `${selectedAsset.symbol}_backtest.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    )
  }

  const exportEquityCurveCsv = () => {
    if (!backtestResult?.equity_curve?.length) return
    const header = ['date', 'value']
    const rows = backtestResult.equity_curve.map((point) =>
      [point.date, point.value]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    )
    downloadFile(
      `${selectedAsset.symbol}_equity_curve.csv`,
      [header.join(','), ...rows].join('\n'),
      'text/csv;charset=utf-8',
    )
  }

  const exportTradesCsv = () => {
    if (!backtestResult?.trades?.length) return
    const header = ['date', 'symbol', 'action', 'price', 'shares', 'commission', 'pnl']
    const rows = backtestResult.trades.map((trade) =>
      [
        trade.date,
        trade.symbol,
        trade.action,
        trade.price,
        trade.shares,
        trade.commission,
        trade.pnl ?? '',
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    )
    downloadFile(
      `${selectedAsset.symbol}_trades.csv`,
      [header.join(','), ...rows].join('\n'),
      'text/csv;charset=utf-8',
    )
  }

  return {
    loadingBacktest,
    backtestError,
    backtestResult,
    backtestMeta,
    runBacktestNow,
    clearBacktestState,
    exportBacktestJson,
    exportEquityCurveCsv,
    exportTradesCsv,
  }
}
