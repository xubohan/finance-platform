import { useEffect, useRef, useState } from 'react'

import {
  compareBacktestStrategies,
  type BacktestCompareMeta,
  type BacktestCompareRankingMetric,
  runBacktest,
  type BacktestCompareRow,
  type BacktestRunData,
  type BacktestRunMeta,
} from '../api/backtest'
import { extractApiError } from '../api/client'
import type { SearchAsset } from '../api/market'
import {
  isFastSlowStrategy,
  isOscillatorStrategy,
  isPeriodMultiplierStrategy,
  isThresholdStrategy,
  type BacktestStrategyName,
} from '../utils/backtestStrategies'
import { downloadFile } from '../utils/download'
import { recordFrontendMetric } from '../utils/runtimePerformance'

type Args = {
  selectedAsset: SearchAsset
  strategyName: BacktestStrategyName
  compareStrategyNames: BacktestStrategyName[]
  compareRankingMetric: BacktestCompareRankingMetric
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
  compareStrategyNames,
  compareRankingMetric,
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
  const [loadingCompare, setLoadingCompare] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [compareRows, setCompareRows] = useState<BacktestCompareRow[]>([])
  const [compareMeta, setCompareMeta] = useState<BacktestCompareMeta | null>(null)
  const [lastBacktestSignature, setLastBacktestSignature] = useState<string | null>(null)
  const [lastCompareSignature, setLastCompareSignature] = useState<string | null>(null)

  selectedAssetRef.current = selectedAsset

  const sortCompareRows = (rows: BacktestCompareRow[]) => {
    if (compareRankingMetric === 'max_drawdown') {
      return [...rows].sort((left, right) => Math.abs(left.max_drawdown) - Math.abs(right.max_drawdown))
    }

    return [...rows].sort((left, right) => {
      const leftValue = left[compareRankingMetric]
      const rightValue = right[compareRankingMetric]
      return Number(rightValue) - Number(leftValue)
    })
  }

  useEffect(() => {
    if (compareRows.length <= 1) return
    setCompareRows((previous) => sortCompareRows(previous))
  }, [compareRankingMetric])

  const buildStrategyParameters = (name: BacktestStrategyName) => {
    const parameters: Record<string, number> = {}
    if (isFastSlowStrategy(name)) {
      parameters.fast = fast
      parameters.slow = slow
    }
    if (isOscillatorStrategy(name)) {
      parameters.period = rsiPeriod
      parameters.oversold = oversold
      parameters.overbought = overbought
    }
    if (name === 'bollinger_reversion') {
      parameters.period = rsiPeriod
      parameters.stddev = oversold
    }
    if (isPeriodMultiplierStrategy(name)) {
      parameters.period = rsiPeriod
      parameters.multiplier = oversold
    }
    if (name === 'vwap_reversion') {
      parameters.period = rsiPeriod
      parameters.deviation_pct = oversold
    }
    if (name === 'atr_breakout') {
      parameters.period = rsiPeriod
      parameters.multiplier = oversold
    }
    if (name === 'donchian_breakout') {
      parameters.lookback = fast
      parameters.exit_lookback = slow
    }
    if (isThresholdStrategy(name)) {
      parameters.period = rsiPeriod
      parameters.threshold = oversold
    }
    if (name === 'cci_reversal') {
      parameters.period = rsiPeriod
      parameters.oversold = oversold
      parameters.overbought = overbought
    }
    return parameters
  }

  const buildCompareParameters = (strategyNames: BacktestStrategyName[]) =>
    strategyNames.reduce<Record<string, Record<string, number>>>((accumulator, name) => {
      const parameters = buildStrategyParameters(name)
      if (Object.keys(parameters).length > 0) {
        accumulator[name] = parameters
      }
      return accumulator
    }, {})

  const buildBacktestSignature = () =>
    JSON.stringify({
      symbol: selectedAsset.symbol,
      assetType: selectedAsset.asset_type,
      strategyName,
      parameters: buildStrategyParameters(strategyName),
      initialCapital,
      backtestStartDate,
      backtestEndDate,
      syncIfMissing,
    })

  const buildCompareSignature = (strategyNames: BacktestStrategyName[]) =>
    JSON.stringify({
      symbol: selectedAsset.symbol,
      assetType: selectedAsset.asset_type,
      strategyNames,
      parametersByStrategy: buildCompareParameters(strategyNames),
      initialCapital,
      backtestStartDate,
      backtestEndDate,
      syncIfMissing,
    })

  const runBacktestNow = async () => {
    if (backtestStartDate > backtestEndDate) {
      setBacktestError('回测开始日期必须早于结束日期')
      return
    }
    const parameters = buildStrategyParameters(strategyName)
    const requestSignature = buildBacktestSignature()

    setLoadingBacktest(true)
    setBacktestError(null)
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const requestSymbol = selectedAsset.symbol
    const requestAssetType = selectedAsset.asset_type
    const started = performance.now()
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
      setLastBacktestSignature(requestSignature)
      recordFrontendMetric('backtest.run', performance.now() - started, { category: 'interaction' })
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
      recordFrontendMetric('backtest.run', performance.now() - started, { category: 'interaction', status: 'error' })
    } finally {
      if (requestIdRef.current === requestId) {
      setLoadingBacktest(false)
      }
    }
  }

  const runStrategyCompare = async () => {
    if (backtestStartDate > backtestEndDate) {
      setCompareError('回测开始日期必须早于结束日期')
      return
    }

    setLoadingCompare(true)
    setCompareError(null)
    const requestSymbol = selectedAsset.symbol
    const requestAssetType = selectedAsset.asset_type
    const started = performance.now()
    const compareSet = Array.from(new Set<BacktestStrategyName>([strategyName, ...compareStrategyNames]))
    const parametersByStrategy = buildCompareParameters(compareSet)
    const requestSignature = buildCompareSignature(compareSet)

    try {
      const resp = await compareBacktestStrategies({
        symbol: requestSymbol,
        asset_type: requestAssetType,
        strategy_names: compareSet,
        parameters_by_strategy: parametersByStrategy,
        start_date: backtestStartDate,
        end_date: backtestEndDate,
        initial_capital: initialCapital,
        sync_if_missing: syncIfMissing,
        ranking_metric: compareRankingMetric,
      })
      if (
        selectedAssetRef.current.symbol !== requestSymbol ||
        selectedAssetRef.current.asset_type !== requestAssetType
      ) {
        return
      }
      setCompareRows(sortCompareRows(resp.data))
      setCompareMeta(resp.meta)
      setLastCompareSignature(requestSignature)
      recordFrontendMetric('backtest.compare', performance.now() - started, {
        category: 'interaction',
        label: '策略对比',
      })
    } catch (error) {
      if (
        selectedAssetRef.current.symbol !== requestSymbol ||
        selectedAssetRef.current.asset_type !== requestAssetType
      ) {
        return
      }
      setCompareRows([])
      setCompareMeta(null)
      setCompareError(extractApiError(error, '运行策略对比失败'))
      recordFrontendMetric('backtest.compare', performance.now() - started, {
        category: 'interaction',
        status: 'error',
        label: '策略对比',
      })
    } finally {
      if (
        selectedAssetRef.current.symbol === requestSymbol &&
        selectedAssetRef.current.asset_type === requestAssetType
      ) {
        setLoadingCompare(false)
      }
    }
  }

  const clearBacktestState = () => {
    setBacktestResult(null)
    setBacktestMeta(null)
    setBacktestError(null)
    setCompareRows([])
    setCompareMeta(null)
    setCompareError(null)
  }

  const isBacktestStale =
    backtestResult !== null &&
    lastBacktestSignature !== null &&
    lastBacktestSignature !== buildBacktestSignature()

  const compareSet = Array.from(new Set<BacktestStrategyName>([strategyName, ...compareStrategyNames]))
  const isCompareStale =
    compareRows.length > 0 &&
    lastCompareSignature !== null &&
    lastCompareSignature !== buildCompareSignature(compareSet)

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

  const exportCompareCsv = () => {
    if (!compareRows.length) return
    const header = ['strategy_name', 'label', 'total_return', 'annual_return', 'sharpe_ratio', 'max_drawdown', 'win_rate', 'trade_count']
    const rows = compareRows.map((row) =>
      [
        row.strategy_name,
        row.label,
        row.total_return,
        row.annual_return,
        row.sharpe_ratio,
        row.max_drawdown,
        row.win_rate,
        row.trade_count,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    )
    downloadFile(
      `${selectedAsset.symbol}_strategy_compare.csv`,
      [header.join(','), ...rows].join('\n'),
      'text/csv;charset=utf-8',
    )
  }

  const exportCompareJson = () => {
    if (!compareRows.length) return
    const compareSet = Array.from(new Set<BacktestStrategyName>([strategyName, ...compareStrategyNames]))
    const payload = {
      asset: selectedAsset,
      request: {
        strategyName,
        compareStrategyNames: compareSet,
        compareRankingMetric,
        parametersByStrategy: buildCompareParameters(compareSet),
        backtestStartDate,
        backtestEndDate,
        initialCapital,
        syncIfMissing,
      },
      meta: compareMeta,
      stale: isCompareStale,
      result: compareRows,
    }
    downloadFile(
      `${selectedAsset.symbol}_strategy_compare.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    )
  }

  return {
    loadingBacktest,
    backtestError,
    backtestResult,
    backtestMeta,
    isBacktestStale,
    loadingCompare,
    compareError,
    compareRows,
    compareMeta,
    isCompareStale,
    runBacktestNow,
    runStrategyCompare,
    clearBacktestState,
    exportBacktestJson,
    exportEquityCurveCsv,
    exportTradesCsv,
    exportCompareCsv,
    exportCompareJson,
  }
}
