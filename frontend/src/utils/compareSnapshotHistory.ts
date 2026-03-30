import type { BacktestCompareRankingMetric } from '../api/backtest'
import { BACKTEST_STRATEGY_VALUES, type BacktestStrategyName } from './backtestStrategies'
import { isValidDateInput, readFiniteNumber } from './marketWorkspace'

export const COMPARE_SNAPSHOT_HISTORY_KEY = 'market-workspace:compare-snapshots'

export type CompareSnapshotHistoryItem = {
  symbol: string
  assetType: 'stock' | 'crypto'
  strategyName: BacktestStrategyName
  compareStrategyNames: BacktestStrategyName[]
  compareRankingMetric: BacktestCompareRankingMetric
  fast: number
  slow: number
  rsiPeriod: number
  oversold: number
  overbought: number
  multiplier: number
  initialCapital: number
  backtestStartDate: string
  backtestEndDate: string
  syncIfMissing: boolean
  bestStrategyName: BacktestStrategyName
  bestStrategyLabel: string
  currentRank: number | null
  storageSource: string | null
  asOf: string | null
  createdAt: string
}

const VALID_STRATEGIES = new Set<BacktestStrategyName>(BACKTEST_STRATEGY_VALUES)
const VALID_COMPARE_RANKING_METRICS = new Set<BacktestCompareRankingMetric>([
  'total_return',
  'annual_return',
  'sharpe_ratio',
  'max_drawdown',
  'win_rate',
  'trade_count',
])

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function parseCompareSnapshotHistory(raw: string | null): CompareSnapshotHistoryItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const candidate = item as Partial<CompareSnapshotHistoryItem>
        if (candidate.assetType !== 'stock' && candidate.assetType !== 'crypto') return null
        if (!candidate.strategyName || !VALID_STRATEGIES.has(candidate.strategyName)) return null
        if (!candidate.bestStrategyName || !VALID_STRATEGIES.has(candidate.bestStrategyName)) return null
        if (
          !candidate.compareRankingMetric ||
          !VALID_COMPARE_RANKING_METRICS.has(candidate.compareRankingMetric)
        ) {
          return null
        }
        const fast = readFiniteNumber(candidate.fast, 1, 250)
        const slow = readFiniteNumber(candidate.slow, 2, 400)
        const rsiPeriod = readFiniteNumber(candidate.rsiPeriod, 2, 100)
        const oversold = readFiniteNumber(candidate.oversold, -1000, 1000)
        const overbought = readFiniteNumber(candidate.overbought, -1000, 1000)
        const multiplier = readFiniteNumber(candidate.multiplier ?? candidate.oversold, -1000, 1000)
        const initialCapital = readFiniteNumber(candidate.initialCapital, 1000, 1_000_000_000)
        if (typeof candidate.symbol !== 'string' || !candidate.symbol.trim()) return null
        if (typeof candidate.createdAt !== 'string' || !candidate.createdAt.trim()) return null
        if (
          fast === null ||
          slow === null ||
          rsiPeriod === null ||
          oversold === null ||
          overbought === null ||
          multiplier === null ||
          initialCapital === null ||
          !isValidDateInput(candidate.backtestStartDate) ||
          !isValidDateInput(candidate.backtestEndDate) ||
          typeof candidate.syncIfMissing !== 'boolean'
        ) {
          return null
        }

        const compareStrategyNames = Array.isArray(candidate.compareStrategyNames)
          ? Array.from(
              new Set(
                candidate.compareStrategyNames.filter(
                  (name): name is BacktestStrategyName =>
                    typeof name === 'string' && VALID_STRATEGIES.has(name as BacktestStrategyName),
                ),
              ),
            ).slice(0, 8)
          : []

        return {
          symbol: candidate.symbol.trim().toUpperCase(),
          assetType: candidate.assetType,
          strategyName: candidate.strategyName,
          compareStrategyNames,
          compareRankingMetric: candidate.compareRankingMetric,
          fast,
          slow,
          rsiPeriod,
          oversold,
          overbought,
          multiplier,
          initialCapital,
          backtestStartDate: candidate.backtestStartDate,
          backtestEndDate: candidate.backtestEndDate,
          syncIfMissing: candidate.syncIfMissing,
          bestStrategyName: candidate.bestStrategyName,
          bestStrategyLabel:
            typeof candidate.bestStrategyLabel === 'string' && candidate.bestStrategyLabel.trim()
              ? candidate.bestStrategyLabel.trim()
              : candidate.bestStrategyName,
          currentRank:
            typeof candidate.currentRank === 'number' && Number.isFinite(candidate.currentRank)
              ? candidate.currentRank
              : null,
          storageSource:
            typeof candidate.storageSource === 'string' && candidate.storageSource.trim()
              ? candidate.storageSource.trim()
              : null,
          asOf: typeof candidate.asOf === 'string' && candidate.asOf.trim() ? candidate.asOf.trim() : null,
          createdAt: candidate.createdAt.trim(),
        } satisfies CompareSnapshotHistoryItem
      })
      .filter((item): item is CompareSnapshotHistoryItem => item !== null)
      .slice(0, 12)
  } catch {
    return []
  }
}

export function readCompareSnapshotHistory(): CompareSnapshotHistoryItem[] {
  return parseCompareSnapshotHistory(readStorage(COMPARE_SNAPSHOT_HISTORY_KEY))
}

export function persistCompareSnapshotHistory(items: CompareSnapshotHistoryItem[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(COMPARE_SNAPSHOT_HISTORY_KEY, JSON.stringify(items.slice(0, 12)))
}

export function clearCompareSnapshotHistoryStorage() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(COMPARE_SNAPSHOT_HISTORY_KEY)
}
