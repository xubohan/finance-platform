import { lazy, Suspense, useEffect, useRef, useState } from 'react'

import {
  type AssetType,
  type SearchAsset,
} from '../api/market'
import AssetOverviewPanel from '../components/market/AssetOverviewPanel'
import AssetSearchPanel from '../components/market/AssetSearchPanel'
import MoversPanel from '../components/market/MoversPanel'
import RecentAssetsPanel from '../components/market/RecentAssetsPanel'
import RuntimeModePanel from '../components/market/RuntimeModePanel'
import WatchlistPanel from '../components/market/WatchlistPanel'
import WatchlistSnapshotPanel from '../components/market/WatchlistSnapshotPanel'
import WorkspaceHero from '../components/market/WorkspaceHero'
import WorkspaceQuickNav from '../components/market/WorkspaceQuickNav'
import { useAssetMarketData } from '../hooks/useAssetMarketData'
import { useAssetCollections } from '../hooks/useAssetCollections'
import { useBacktestWorkspace } from '../hooks/useBacktestWorkspace'
import { useFrontendPerformance } from '../hooks/useFrontendPerformance'
import { useWatchlistQuotes } from '../hooks/useWatchlistQuotes'
import { useWorkspaceDiscovery } from '../hooks/useWorkspaceDiscovery'
import { useWorkspaceStorage } from '../hooks/useWorkspaceStorage'
import { BACKTEST_STRATEGIES, type BacktestStrategyName } from '../utils/backtestStrategies'
import { COMPARE_STRATEGY_TEMPLATES } from '../utils/compareStrategyTemplates'
import {
  clearCompareSnapshotHistoryStorage,
  persistCompareSnapshotHistory,
  readCompareSnapshotHistory,
  type CompareSnapshotHistoryItem,
} from '../utils/compareSnapshotHistory'
import { displayFixed, displayLocaleNumber, displayPercent, displayText } from '../utils/display'
import { formatAsOf } from '../utils/time'

const COMPARE_RANKING_OPTIONS = [
  { value: 'total_return', label: '总收益' },
  { value: 'annual_return', label: '年化收益' },
  { value: 'sharpe_ratio', label: '夏普' },
  { value: 'max_drawdown', label: '最大回撤' },
  { value: 'win_rate', label: '胜率' },
  { value: 'trade_count', label: '成交数' },
] as const

const SAVED_COMPARE_TEMPLATE_STORAGE_KEY = 'market-workspace:saved-compare-templates'
const VALID_COMPARE_RANKING_VALUES = new Set(COMPARE_RANKING_OPTIONS.map((option) => option.value))
const VALID_COMPARE_STRATEGY_VALUES = new Set(BACKTEST_STRATEGIES.map((strategy) => strategy.value))

type SavedCompareTemplate = {
  id: string
  label: string
  compareStrategyNames: BacktestStrategyName[]
  compareRankingMetric: (typeof COMPARE_RANKING_OPTIONS)[number]['value']
  symbol: string | null
  assetType: AssetType | null
  createdAt: string
}

type CompareJourneyStatus = 'done' | 'active' | 'upcoming'

type CompareJourneyAction = {
  label: string
  onClick: () => void
  disabled: boolean
}

type CompareJourneyStep = {
  key: string
  title: string
  status: CompareJourneyStatus
  detail: string
  action?: CompareJourneyAction | null
}

function getCompareJourneyStatusLabel(status: CompareJourneyStatus) {
  if (status === 'done') return '已完成'
  if (status === 'active') return '下一步'
  return '稍后'
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function getSavedCompareTemplateSignature(template: Pick<SavedCompareTemplate, 'compareStrategyNames' | 'compareRankingMetric'>) {
  return `${template.compareRankingMetric}:${template.compareStrategyNames.join(',')}`
}

function parseSavedCompareTemplates(raw: string | null): SavedCompareTemplate[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const candidate = item as Partial<SavedCompareTemplate>
        if (
          typeof candidate.id !== 'string' ||
          !candidate.id.trim() ||
          typeof candidate.label !== 'string' ||
          !candidate.label.trim() ||
          typeof candidate.createdAt !== 'string' ||
          !candidate.createdAt.trim() ||
          !candidate.compareRankingMetric ||
          !VALID_COMPARE_RANKING_VALUES.has(candidate.compareRankingMetric)
        ) {
          return null
        }
        const compareStrategyNames = Array.isArray(candidate.compareStrategyNames)
          ? Array.from(
              new Set(
                candidate.compareStrategyNames.filter(
                  (name): name is BacktestStrategyName =>
                    typeof name === 'string' && VALID_COMPARE_STRATEGY_VALUES.has(name as BacktestStrategyName),
                ),
              ),
            ).slice(0, 8)
          : []
        return {
          id: candidate.id.trim(),
          label: candidate.label.trim(),
          compareStrategyNames,
          compareRankingMetric: candidate.compareRankingMetric,
          symbol: typeof candidate.symbol === 'string' && candidate.symbol.trim() ? candidate.symbol.trim().toUpperCase() : null,
          assetType: candidate.assetType === 'stock' || candidate.assetType === 'crypto' ? candidate.assetType : null,
          createdAt: candidate.createdAt.trim(),
        } satisfies SavedCompareTemplate
      })
      .filter((item): item is SavedCompareTemplate => item !== null)
      .slice(0, 8)
  } catch {
    return []
  }
}

function readSavedCompareTemplates(): SavedCompareTemplate[] {
  return parseSavedCompareTemplates(readStorage(SAVED_COMPARE_TEMPLATE_STORAGE_KEY))
}

function persistSavedCompareTemplates(templates: SavedCompareTemplate[]) {
  if (typeof window === 'undefined') return
  if (templates.length === 0) {
    window.localStorage.removeItem(SAVED_COMPARE_TEMPLATE_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(SAVED_COMPARE_TEMPLATE_STORAGE_KEY, JSON.stringify(templates.slice(0, 8)))
}

function getCompareRankingLabel(metric: (typeof COMPARE_RANKING_OPTIONS)[number]['value']) {
  return COMPARE_RANKING_OPTIONS.find((option) => option.value === metric)?.label ?? metric
}

function formatCompareMetric(metric: (typeof COMPARE_RANKING_OPTIONS)[number]['value'], value: number) {
  if (metric === 'sharpe_ratio') return displayFixed(value, 2)
  if (metric === 'trade_count') return displayLocaleNumber(value)
  return displayPercent(value, 2)
}

function formatCompareLead(metric: (typeof COMPARE_RANKING_OPTIONS)[number]['value'], value: number) {
  const formatted = formatCompareMetric(metric, value)
  return formatted === '-' ? formatted : `领先 ${formatted}`
}

function getCompareSnapshotKey(snapshot: CompareSnapshotHistoryItem) {
  return `${snapshot.createdAt}:${snapshot.symbol}:${snapshot.bestStrategyName}:${snapshot.compareRankingMetric}`
}

function getCompareDecisionThreshold(metric: (typeof COMPARE_RANKING_OPTIONS)[number]['value']) {
  if (metric === 'sharpe_ratio') return 0.2
  if (metric === 'trade_count') return 2
  return 1
}

function getCompareDecisionState(params: {
  buyHoldTotalReturnDelta: number | null
  compareGapValue: number | null
  compareRankingMetric: (typeof COMPARE_RANKING_OPTIONS)[number]['value']
  currentCompareRank: number
  compareRowsLength: number
  bestStrategyLabel: string | null
  topCandidateLabel: string | null
}) {
  const {
    buyHoldTotalReturnDelta,
    compareGapValue,
    compareRankingMetric,
    currentCompareRank,
    compareRowsLength,
    bestStrategyLabel,
    topCandidateLabel,
  } = params

  if (currentCompareRank === 0) {
    if (buyHoldTotalReturnDelta !== null && buyHoldTotalReturnDelta < 0) {
      return {
        title: '当前候选最优，但仍落后基准',
        detail: `当前策略已排第 1 / ${compareRowsLength}，但仍落后 Buy&Hold ${displayPercent(
          Math.abs(buyHoldTotalReturnDelta),
          2,
        )}，建议把基准一起保留到下一轮。`,
      }
    }
    return {
      title: '当前策略可继续做主策略',
      detail: topCandidateLabel
        ? `当前策略已排第 1 / ${compareRowsLength}，建议保留 ${topCandidateLabel} 作为防守候选继续观察。`
        : `当前策略已排第 1 / ${compareRowsLength}，当前没有更优候选，可直接进入下一轮回测复核。`,
    }
  }

  if (buyHoldTotalReturnDelta !== null && buyHoldTotalReturnDelta < 0) {
    return {
      title: '先别切策略，先守住基准',
      detail: `当前策略比 Buy&Hold 低 ${displayPercent(
        Math.abs(buyHoldTotalReturnDelta),
        2,
      )}，建议至少保留 Buy&Hold 和 ${bestStrategyLabel ?? '最佳策略'} 一起重跑。`,
    }
  }

  if (compareGapValue !== null) {
    const threshold = getCompareDecisionThreshold(compareRankingMetric)
    if (compareGapValue <= threshold) {
      return {
        title: '差距不大，适合缩池复核',
        detail: `当前只落后 ${bestStrategyLabel ?? '最佳策略'} ${formatCompareMetric(
          compareRankingMetric,
          compareGapValue,
        )}，建议保留前三候选后再跑一轮。`,
      }
    }
  }

  return {
    title: '当前策略明显落后，建议切主策略',
    detail: `最佳策略是 ${bestStrategyLabel ?? '-'}，当前差距 ${compareGapValue === null ? '-' : formatCompareMetric(
      compareRankingMetric,
      compareGapValue,
    )}，优先考虑“设为当前策略”后再复测。`,
  }
}

const loadChartPanel = () => import('../components/market/ChartPanel')
const loadBacktestPanel = () => import('../components/market/BacktestPanel')

const ChartPanel = lazy(loadChartPanel)
const BacktestPanel = lazy(loadBacktestPanel)

function PanelLoadingFallback({ title, description }: { title: string; description: string }) {
  return (
    <section className="workspace-panel panel-loading-shell" aria-busy="true">
      <div className="panel-head">
        <h3>{title}</h3>
        <span>{description}</span>
      </div>
      <div className="empty-state panel-loading-state">
        <strong>组件加载中</strong>
        <p>当前面板正在按需加载，优先保证首屏搜索和行情摘要更快可交互。</p>
      </div>
    </section>
  )
}

export default function MarketPage() {
  const BACKTEST_TRADES_PAGE_SIZE = 8
  const [compareCopyState, setCompareCopyState] = useState<'idle' | 'done' | 'error'>('idle')
  const [compareBroadcastCopyState, setCompareBroadcastCopyState] = useState<'idle' | 'done' | 'error'>('idle')
  const [compareMarkdownCopyState, setCompareMarkdownCopyState] = useState<'idle' | 'done' | 'error'>('idle')
  const [compareTemplateCopyState, setCompareTemplateCopyState] = useState<'idle' | 'done' | 'error'>('idle')
  const [compareTemplateImportState, setCompareTemplateImportState] = useState<'idle' | 'done' | 'error'>('idle')
  const [compareSnapshotFilter, setCompareSnapshotFilter] = useState<'asset' | 'all'>('asset')
  const [showAllCompareSnapshots, setShowAllCompareSnapshots] = useState(false)
  const [showCompareAdvancedTools, setShowCompareAdvancedTools] = useState(false)
  const [showCompareReviewTools, setShowCompareReviewTools] = useState(false)
  const [savedCompareTemplateFilter, setSavedCompareTemplateFilter] = useState<'asset' | 'all'>('asset')
  const [savedCompareTemplates, setSavedCompareTemplates] = useState<SavedCompareTemplate[]>(() => readSavedCompareTemplates())
  const [compareSnapshots, setCompareSnapshots] = useState<CompareSnapshotHistoryItem[]>(() => readCompareSnapshotHistory())
  const [previousStrategyName, setPreviousStrategyName] = useState<BacktestStrategyName | null>(null)
  const [pendingBacktestStrategy, setPendingBacktestStrategy] = useState<BacktestStrategyName | null>(null)
  const [pendingCompareTemplateId, setPendingCompareTemplateId] = useState<string | null>(null)
  const [compareUndoSnapshot, setCompareUndoSnapshot] = useState<{
    strategyName: BacktestStrategyName
    compareStrategyNames: BacktestStrategyName[]
    previousStrategyName: BacktestStrategyName | null
  } | null>(null)
  const lastSavedCompareSnapshotRef = useRef<string | null>(null)
  const {
    searchScope,
    setSearchScope,
    searchInput,
    setSearchInput,
    selectedAsset,
    period,
    setPeriod,
    chartStartDate,
    setChartStartDate,
    chartEndDate,
    setChartEndDate,
    selectedIndicators,
    strategyName,
    setStrategyName,
    fast,
    setFast,
    slow,
    setSlow,
    rsiPeriod,
    setRsiPeriod,
    oversold,
    setOversold,
    overbought,
    setOverbought,
    initialCapital,
    setInitialCapital,
    backtestStartDate,
    setBacktestStartDate,
    backtestEndDate,
    setBacktestEndDate,
    syncIfMissing,
    setSyncIfMissing,
    backtestTradesPage,
    setBacktestTradesPage,
    compareStrategyNames,
    compareRankingMetric,
    setCompareRankingMetric,
    toggleCompareStrategy,
    replaceCompareStrategies,
    selectAsset,
    applyInputAsset,
    selectMoverAsset,
    resetWorkspace,
    toggleIndicator,
    applyChartPreset,
    applyBacktestPreset,
  } = useWorkspaceStorage()

  const {
    recentAssets,
    watchlistAssets,
    clearRecentAssets,
    clearWatchlistAssets,
    rememberAsset,
    toggleWatchlist,
    isWatchlisted,
    exportWatchlistCsv,
  } = useAssetCollections()
  const {
    rows: watchlistQuoteRows,
    loading: loadingWatchlistQuotes,
    error: watchlistQuoteError,
  } = useWatchlistQuotes(watchlistAssets)
  const {
    deferredSearch,
    searchLoading,
    searchError,
    searchResults,
    clearSearchResults,
    stockMovers,
    cryptoMovers,
    stockMoversMeta,
    cryptoMoversMeta,
    moversError,
    health,
    healthError,
    observability,
    observabilityError,
    cacheMaintenance,
    cacheMaintenanceError,
  } = useWorkspaceDiscovery(searchInput, searchScope)
  const {
    quote,
    candles,
    marketMeta,
    marketError,
    loadingQuote,
    historyStatus,
    historyError,
    loadingHistory,
    syncingHistory,
    refreshChart,
    syncHistoryNow,
    quoteSource,
    klineSource,
    chartStateText,
  } = useAssetMarketData({
    selectedAsset,
    period,
    chartStartDate,
    chartEndDate,
  })

  const {
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
    exportCompareCsv,
    exportCompareJson,
    exportEquityCurveCsv,
    exportTradesCsv,
  } = useBacktestWorkspace({
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
  })
  const frontendPerformance = useFrontendPerformance()

  const handleSelectAsset = (asset: SearchAsset) => {
    rememberAsset(asset)
    selectAsset(asset)
    clearSearchResults()
    clearBacktestState()
    setBacktestTradesPage(1)
  }

  const handleApplyInput = () => {
    const asset = applyInputAsset()
    if (!asset) return
    rememberAsset(asset)
    clearSearchResults()
    clearBacktestState()
    setBacktestTradesPage(1)
  }

  const handleSelectMover = (symbol: string, assetType: AssetType) => {
    const asset = selectMoverAsset(symbol, assetType)
    rememberAsset(asset)
    clearBacktestState()
    setBacktestTradesPage(1)
  }

  const handleClearRecentAssets = () => {
    clearRecentAssets()
  }

  const handleResetWorkspace = () => {
    resetWorkspace()
    clearSearchResults()
    clearBacktestState()
    refreshChart()
    setBacktestTradesPage(1)
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
    setCompareSnapshotFilter('asset')
    setShowAllCompareSnapshots(false)
    setShowCompareReviewTools(false)
    setPreviousStrategyName(null)
    setPendingBacktestStrategy(null)
    setCompareUndoSnapshot(null)
  }

  const handleClearCompareSnapshots = () => {
    clearCompareSnapshotHistoryStorage()
    setCompareSnapshots([])
  }

  const handleRestoreCompareSnapshot = (snapshot: CompareSnapshotHistoryItem) => {
    const asset = {
      symbol: snapshot.symbol,
      name: snapshot.symbol,
      asset_type: snapshot.assetType,
      market: snapshot.assetType === 'crypto' ? 'CRYPTO' : 'WATCHLIST',
    } satisfies SearchAsset
    rememberCompareUndoSnapshot()
    rememberAsset(asset)
    setSearchScope(snapshot.assetType)
    selectAsset(asset, asset.symbol)
    setPreviousStrategyName(strategyName)
    setStrategyName(snapshot.strategyName)
    replaceCompareStrategies(snapshot.compareStrategyNames)
    setCompareRankingMetric(snapshot.compareRankingMetric)
    setFast(snapshot.fast)
    setSlow(snapshot.slow)
    setRsiPeriod(snapshot.rsiPeriod)
    setOversold(snapshot.oversold)
    setOverbought(snapshot.overbought)
    setInitialCapital(snapshot.initialCapital)
    setBacktestStartDate(snapshot.backtestStartDate)
    setBacktestEndDate(snapshot.backtestEndDate)
    setSyncIfMissing(snapshot.syncIfMissing)
    clearSearchResults()
    clearBacktestState()
    setBacktestTradesPage(1)
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
  }

  const handleDeleteCompareSnapshot = (snapshot: CompareSnapshotHistoryItem) => {
    const snapshotKey = getCompareSnapshotKey(snapshot)
    const nextSnapshots = compareSnapshots.filter((item) => getCompareSnapshotKey(item) !== snapshotKey)
    if (nextSnapshots.length === 0) {
      clearCompareSnapshotHistoryStorage()
    } else {
      persistCompareSnapshotHistory(nextSnapshots)
    }
    setCompareSnapshots(nextSnapshots)
  }

  const queueCompareRun = (reason: string) => {
    setPendingCompareTemplateId(reason)
  }

  const handleApplyCompareTemplateAndRun = (templateStrategies: readonly BacktestStrategyName[]) => {
    handleApplyCompareTemplate(templateStrategies)
    queueCompareRun(`compare-template:${Date.now()}`)
  }

  const handleSaveCompareTemplate = () => {
    const nextTemplate: SavedCompareTemplate = {
      id: `compare-template:${Date.now()}`,
      label: `${selectedAsset.symbol} / ${getCompareRankingLabel(compareRankingMetric)} / ${displayLocaleNumber(compareStrategyNames.length + 1)}策`,
      compareStrategyNames: [...compareStrategyNames],
      compareRankingMetric,
      symbol: selectedAsset.symbol,
      assetType: selectedAsset.asset_type,
      createdAt: new Date().toISOString(),
    }
    const nextSignature = getSavedCompareTemplateSignature(nextTemplate)
    const existingTemplate = savedCompareTemplates.find(
      (item) => getSavedCompareTemplateSignature(item) === nextSignature,
    )
    const mergedTemplate = existingTemplate
      ? {
          ...existingTemplate,
          label: nextTemplate.label,
          createdAt: nextTemplate.createdAt,
        }
      : nextTemplate
    const nextTemplates = [
      mergedTemplate,
      ...savedCompareTemplates.filter((item) => item.id !== mergedTemplate.id),
    ].slice(0, 8)
    persistSavedCompareTemplates(nextTemplates)
    setSavedCompareTemplates(nextTemplates)
    setCompareTemplateCopyState('idle')
    setCompareTemplateImportState('idle')
  }

  const handleApplySavedCompareTemplate = (template: SavedCompareTemplate, options?: { runCompare?: boolean }) => {
    const nextStrategies = Array.from(new Set(template.compareStrategyNames.filter((name) => name !== strategyName)))
    rememberCompareUndoSnapshot()
    replaceCompareStrategies(nextStrategies)
    setCompareRankingMetric(template.compareRankingMetric)
    clearBacktestState()
    setBacktestTradesPage(1)
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
    setPendingCompareTemplateId(options?.runCompare ? template.id : null)
  }

  const handleDeleteSavedCompareTemplate = (template: SavedCompareTemplate) => {
    const nextTemplates = savedCompareTemplates.filter((item) => item.id !== template.id)
    persistSavedCompareTemplates(nextTemplates)
    setSavedCompareTemplates(nextTemplates)
    setCompareTemplateCopyState('idle')
    setCompareTemplateImportState('idle')
  }

  const handleCopySavedCompareTemplates = async () => {
    if (savedCompareTemplates.length === 0 || !navigator.clipboard?.writeText) {
      setCompareTemplateCopyState('error')
      return
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(savedCompareTemplates, null, 2))
      setCompareTemplateCopyState('done')
    } catch {
      setCompareTemplateCopyState('error')
    }
  }

  const handleImportSavedCompareTemplates = () => {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
      setCompareTemplateImportState('error')
      return
    }
    const raw = window.prompt('粘贴模板 JSON')
    if (!raw || !raw.trim()) return
    const importedTemplates = parseSavedCompareTemplates(raw)
    if (importedTemplates.length === 0) {
      setCompareTemplateImportState('error')
      return
    }
    const importedSignatures = new Set(importedTemplates.map((item) => getSavedCompareTemplateSignature(item)))
    const nextTemplates = [
      ...importedTemplates.map((item, index) => ({
        ...item,
        id: item.id || `compare-template:import:${Date.now()}:${index}`,
      })),
      ...savedCompareTemplates.filter((item) => !importedSignatures.has(getSavedCompareTemplateSignature(item))),
    ].slice(0, 8)
    persistSavedCompareTemplates(nextTemplates)
    setSavedCompareTemplates(nextTemplates)
    setCompareTemplateImportState('done')
  }

  const handleRenameSavedCompareTemplate = (template: SavedCompareTemplate) => {
    if (typeof window === 'undefined' || typeof window.prompt !== 'function') return
    const nextLabel = window.prompt('请输入新的模板名称', template.label)?.trim()
    if (!nextLabel || nextLabel === template.label) return
    const nextTemplates = savedCompareTemplates.map((item) =>
      item.id === template.id
        ? {
            ...item,
            label: nextLabel.slice(0, 80),
          }
        : item,
    )
    persistSavedCompareTemplates(nextTemplates)
    setSavedCompareTemplates(nextTemplates)
    setCompareTemplateCopyState('idle')
    setCompareTemplateImportState('idle')
  }

  const rememberCompareUndoSnapshot = () => {
    setCompareUndoSnapshot({
      strategyName,
      compareStrategyNames: [...compareStrategyNames],
      previousStrategyName,
    })
  }

  const buildAdoptedComparePool = (nextStrategyName: typeof strategyName) =>
    [strategyName, ...compareStrategyNames].filter((name, index, items) => {
      if (name === nextStrategyName) return false
      return items.indexOf(name) === index
    })

  const handleAdoptCompareStrategy = (nextStrategyName: typeof strategyName, options?: { runBacktest?: boolean }) => {
    if (nextStrategyName === strategyName) return
    rememberCompareUndoSnapshot()
    setPreviousStrategyName(strategyName)
    replaceCompareStrategies(buildAdoptedComparePool(nextStrategyName))
    setStrategyName(nextStrategyName)
    setPendingBacktestStrategy(options?.runBacktest ? nextStrategyName : null)
    clearBacktestState()
    setBacktestTradesPage(1)
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
  }

  const handleStrategyChange = (nextStrategyName: typeof strategyName) => {
    if (nextStrategyName === strategyName) return
    rememberCompareUndoSnapshot()
    setPreviousStrategyName(strategyName)
    setStrategyName(nextStrategyName)
    replaceCompareStrategies(buildAdoptedComparePool(nextStrategyName))
  }

  const handleApplyCompareTemplate = (templateStrategies: readonly BacktestStrategyName[]) => {
    const nextStrategies = Array.from(new Set(templateStrategies.filter((name) => name !== strategyName)))
    if (
      nextStrategies.length === compareStrategyNames.length &&
      nextStrategies.every((name, index) => compareStrategyNames[index] === name)
    ) {
      return
    }
    rememberCompareUndoSnapshot()
    replaceCompareStrategies(nextStrategies)
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
  }

  const handleKeepTopCompareCandidates = () => {
    if (compareRows.length === 0 || isCompareStale) return
    rememberCompareUndoSnapshot()
    replaceCompareStrategies(
      compareRows
        .filter((row) => row.strategy_name !== strategyName)
        .slice(0, 3)
        .map((row) => row.strategy_name),
    )
    clearBacktestState()
    setBacktestTradesPage(1)
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
  }

  const handleKeepBetterCompareCandidates = () => {
    if (compareRows.length === 0 || isCompareStale || currentCompareRank <= 0) return
    rememberCompareUndoSnapshot()
    replaceCompareStrategies(compareRows.slice(0, currentCompareRank).map((row) => row.strategy_name))
    clearBacktestState()
    setBacktestTradesPage(1)
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
  }

  const handleToggleCompareStrategy = (name: BacktestStrategyName) => {
    const nextStrategies = compareStrategyNames.includes(name)
      ? compareStrategyNames.filter((item) => item !== name)
      : compareStrategyNames.length >= 8
        ? compareStrategyNames
        : [...compareStrategyNames, name]
    if (
      nextStrategies.length === compareStrategyNames.length &&
      nextStrategies.every((item, index) => compareStrategyNames[index] === item)
    ) {
      return
    }
    rememberCompareUndoSnapshot()
    replaceCompareStrategies(nextStrategies)
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
  }

  const handleUndoCompareAdjustment = () => {
    if (!compareUndoSnapshot) return
    setStrategyName(compareUndoSnapshot.strategyName)
    replaceCompareStrategies(compareUndoSnapshot.compareStrategyNames)
    setPreviousStrategyName(compareUndoSnapshot.previousStrategyName)
    setCompareUndoSnapshot(null)
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
  }

  const isCompareTemplateActive = (templateStrategies: readonly string[]) => {
    const normalized = Array.from(new Set(templateStrategies.filter((name) => name !== strategyName)))
    return (
      normalized.length === compareStrategyNames.length &&
      normalized.every((name, index) => compareStrategyNames[index] === name)
    )
  }

  const allTrades = backtestResult?.trades ? [...backtestResult.trades].reverse() : []
  const backtestTradesPageCount = Math.max(1, Math.ceil(allTrades.length / BACKTEST_TRADES_PAGE_SIZE))
  const trades = allTrades.slice(
    (backtestTradesPage - 1) * BACKTEST_TRADES_PAGE_SIZE,
    backtestTradesPage * BACKTEST_TRADES_PAGE_SIZE,
  )
  const currentCompareRank = compareRows.findIndex((row) => row.strategy_name === strategyName)
  const currentCompareRow = currentCompareRank >= 0 ? compareRows[currentCompareRank] : null
  const bestCompareRow = compareRows[0] ?? null
  const buyHoldCompareRow = compareRows.find((row) => row.strategy_name === 'buy_hold') ?? null
  const topCompareCandidates = compareRows.filter((row) => row.strategy_name !== strategyName).slice(0, 3)
  const currentStrategyLabel =
    BACKTEST_STRATEGIES.find((strategy) => strategy.value === strategyName)?.label ?? strategyName
  const previousStrategyLabel =
    previousStrategyName
      ? BACKTEST_STRATEGIES.find((strategy) => strategy.value === previousStrategyName)?.label ?? previousStrategyName
      : null
  const assetCompareSnapshots = compareSnapshots.filter(
    (item) => item.symbol === selectedAsset.symbol && item.assetType === selectedAsset.asset_type,
  )
  const assetSavedCompareTemplates = savedCompareTemplates.filter(
    (item) => item.symbol === selectedAsset.symbol && item.assetType === selectedAsset.asset_type,
  )
  const isCompareSnapshotFallbackToAll =
    compareSnapshotFilter === 'asset' && assetCompareSnapshots.length === 0 && compareSnapshots.length > 0
  const isSavedCompareTemplateFallbackToAll =
    savedCompareTemplateFilter === 'asset' && assetSavedCompareTemplates.length === 0 && savedCompareTemplates.length > 0
  const compareSnapshotPool =
    compareSnapshotFilter === 'asset' && assetCompareSnapshots.length > 0 ? assetCompareSnapshots : compareSnapshots
  const visibleSavedCompareTemplates =
    savedCompareTemplateFilter === 'asset' && assetSavedCompareTemplates.length > 0
      ? assetSavedCompareTemplates
      : savedCompareTemplates
  const recentCompareSnapshots = showAllCompareSnapshots ? compareSnapshotPool : compareSnapshotPool.slice(0, 3)
  const coreCompareTemplate = COMPARE_STRATEGY_TEMPLATES.find((template) => template.value === 'core')
  const trendCompareTemplate = COMPARE_STRATEGY_TEMPLATES.find((template) => template.value === 'trend')
  const activeCompareTemplate = COMPARE_STRATEGY_TEMPLATES.find((template) => isCompareTemplateActive(template.strategies)) ?? null
  const comparePoolSize = compareStrategyNames.length + 1
  const activeCompareRanking = COMPARE_RANKING_OPTIONS.find((option) => option.value === compareRankingMetric)
  const activeCompareTemplateLabel =
    activeCompareTemplate?.label ?? (compareStrategyNames.length === 0 ? '仅当前' : '自定义池')
  const activeCompareMetricValue = currentCompareRow
    ? formatCompareMetric(compareRankingMetric, Number(currentCompareRow[compareRankingMetric]))
    : '-'
  const hasFreshBacktest = Boolean(backtestResult) && !isBacktestStale
  const hasFreshCompare = compareRows.length > 0 && !isCompareStale
  const compareGapValue =
    currentCompareRow && bestCompareRow
      ? compareRankingMetric === 'max_drawdown'
        ? Math.max(Math.abs(currentCompareRow.max_drawdown) - Math.abs(bestCompareRow.max_drawdown), 0)
        : Math.max(Number(bestCompareRow[compareRankingMetric]) - Number(currentCompareRow[compareRankingMetric]), 0)
      : null
  const getCandidateLeadValue = (strategyName: string) => {
    const row = compareRows.find((item) => item.strategy_name === strategyName)
    if (!row || !currentCompareRow || row.strategy_name === currentCompareRow.strategy_name) return null
    return compareRankingMetric === 'max_drawdown'
      ? Math.max(Math.abs(currentCompareRow.max_drawdown) - Math.abs(row.max_drawdown), 0)
      : Math.max(Number(row[compareRankingMetric]) - Number(currentCompareRow[compareRankingMetric]), 0)
  }
  const getCandidateShortcutLabel = (strategyName: string) => {
    const row = compareRows.find((item) => item.strategy_name === strategyName)
    if (!row) return strategyName
    const rank = compareRows.findIndex((item) => item.strategy_name === strategyName)
    const leadValue = getCandidateLeadValue(strategyName)
    const leadSuffix = leadValue === null ? '' : ` · ${formatCompareLead(compareRankingMetric, leadValue)}`
    return `#${rank + 1} ${row.label}${leadSuffix}`
  }
  const buyHoldTotalReturnDelta =
    currentCompareRow &&
    buyHoldCompareRow &&
    currentCompareRow.strategy_name !== 'buy_hold'
      ? Number(currentCompareRow.total_return) - Number(buyHoldCompareRow.total_return)
      : null
  const compareDecision =
    compareRows.length > 0
      ? getCompareDecisionState({
          buyHoldTotalReturnDelta,
          compareGapValue,
          compareRankingMetric,
          currentCompareRank,
          compareRowsLength: compareRows.length,
          bestStrategyLabel: bestCompareRow?.label ?? null,
          topCandidateLabel: topCompareCandidates[0]?.label ?? null,
        })
      : null
  const compareDecisionPrimaryAction =
    compareDecision && !isCompareStale
      ? currentCompareRank === 0
        ? buyHoldTotalReturnDelta !== null &&
          buyHoldTotalReturnDelta < 0 &&
          buyHoldCompareRow &&
          strategyName !== 'buy_hold'
          ? {
              label: '切到 Buy&Hold 并回测',
              onClick: () => handleAdoptCompareStrategy('buy_hold', { runBacktest: true }),
              disabled: loadingBacktest,
            }
          : topCompareCandidates[0]
            ? {
                label: '保留前三候选',
                onClick: handleKeepTopCompareCandidates,
                disabled: false,
              }
            : null
        : bestCompareRow && bestCompareRow.strategy_name !== strategyName
          ? {
              label: '切到最佳并回测',
              onClick: () => handleAdoptCompareStrategy(bestCompareRow.strategy_name, { runBacktest: true }),
              disabled: loadingBacktest,
            }
          : null
      : null
  const compareDecisionSecondaryAction =
    compareDecision &&
    !isCompareStale &&
    currentCompareRank > 0 &&
    compareGapValue !== null &&
    compareGapValue <= getCompareDecisionThreshold(compareRankingMetric)
      ? {
          label: '仅保留优于当前',
          onClick: handleKeepBetterCompareCandidates,
          disabled: false,
        }
      : null
  const compareJourneySteps: CompareJourneyStep[] = [
    {
      key: 'backtest',
      title: '1. 先跑当前策略',
      status: hasFreshBacktest ? 'done' : 'active',
      detail: hasFreshBacktest
        ? `${currentStrategyLabel} 已有最新回测结果，可以直接拿它做基线。`
        : isBacktestStale
          ? `参数刚改过，先重跑 ${currentStrategyLabel}，确认这组设置还能稳定出结果。`
          : `${currentStrategyLabel} 还没有最新回测结果，先确认当前参数跑得通。`,
      action: hasFreshBacktest
        ? null
        : {
            label: loadingBacktest ? '基线回测中...' : backtestResult ? '重跑基线回测' : '先跑基线回测',
            onClick: () => {
              void runBacktestNow()
            },
            disabled: loadingBacktest,
          },
    },
    {
      key: 'compare',
      title: '2. 再跑候选池对比',
      status: hasFreshCompare ? 'done' : hasFreshBacktest ? 'active' : 'upcoming',
      detail: hasFreshCompare
        ? `已完成 ${displayLocaleNumber(compareRows.length)} 策对比，当前策略排名 ${
            currentCompareRank >= 0 ? `#${currentCompareRank + 1} / ${compareRows.length}` : '待确认'
          }。`
        : !hasFreshBacktest
          ? '先完成第 1 步，再跑候选池对比；第一次上手优先用核心池。'
          : isCompareStale
            ? '候选池或参数已经变化，重跑对比后再看结论更可靠。'
            : activeCompareTemplate?.value === 'current_only'
              ? '当前只会比较主策略自己；首次上手更适合切到核心池再跑一轮。'
              : `当前模板 ${activeCompareTemplateLabel}，共 ${displayLocaleNumber(comparePoolSize)} 策，直接运行对比即可。`,
      action: hasFreshCompare || !hasFreshBacktest
        ? null
        : isCompareStale || compareRows.length > 0
          ? {
              label: loadingCompare ? '候选池对比中...' : '重跑当前对比',
              onClick: () => {
                void runStrategyCompare()
              },
              disabled: loadingCompare,
            }
          : activeCompareTemplate?.value === 'current_only' && coreCompareTemplate
            ? {
                label: '用核心池开始首次对比',
                onClick: () => handleApplyCompareTemplateAndRun(coreCompareTemplate.strategies),
                disabled: loadingCompare,
              }
            : {
                label: loadingCompare ? '候选池对比中...' : '运行当前池对比',
                onClick: () => {
                  void runStrategyCompare()
                },
                disabled: loadingCompare,
              },
    },
    {
      key: 'decision',
      title: '3. 根据结果收敛',
      status: !hasFreshCompare ? 'upcoming' : compareDecisionPrimaryAction || compareDecisionSecondaryAction ? 'active' : 'done',
      detail: !hasFreshCompare
        ? '对比跑完后，这里会告诉你是切换主策略、缩小候选池，还是继续保留当前策略。'
        : compareDecision?.detail ??
          (currentCompareRank === 0
            ? '当前策略已经领先，可以保留防守候选后继续复核。'
            : '对比结果已经就绪，可以切主策略或缩池后继续复测。'),
      action: null,
    },
  ]
  const quoteText =
    quote && Number.isFinite(Number(quote.price))
      ? `${displayLocaleNumber(quote.price)} (${displayPercent(quote.change_pct_24h, 2)})`
      : loadingQuote
        ? '报价加载中...'
        : '-'

  const compareSummaryText =
    compareRows.length > 0
      ? [
          `${selectedAsset.symbol} 策略对比`,
          `排序指标: ${displayText(activeCompareRanking?.label)}`,
          `当前策略: ${displayText(currentCompareRow?.label)} (${currentCompareRank >= 0 ? `#${currentCompareRank + 1}/${compareRows.length}` : '-'})`,
          `最佳策略: ${displayText(bestCompareRow?.label)}`,
          `当前指标: ${activeCompareMetricValue}`,
          `距最优: ${compareGapValue === null ? '-' : formatCompareMetric(compareRankingMetric, compareGapValue)}`,
          `数据快照: ${displayText(compareMeta?.storage_source)} @ ${formatAsOf(compareMeta?.as_of)}`,
        ].join('\n')
      : ''

  const compareBroadcastText =
    compareRows.length > 0
      ? [
          `${selectedAsset.symbol} 回测复盘`,
          `${displayText(currentCompareRow?.label)} 当前 #${currentCompareRank >= 0 ? currentCompareRank + 1 : '-'} / ${compareRows.length}`,
          `最优 ${displayText(bestCompareRow?.label)}`,
          `${displayText(activeCompareRanking?.label)} ${activeCompareMetricValue}`,
          `距最优 ${compareGapValue === null ? '-' : formatCompareMetric(compareRankingMetric, compareGapValue)}`,
          `相对 Buy&Hold ${buyHoldTotalReturnDelta === null ? '-' : displayPercent(buyHoldTotalReturnDelta, 2)}`,
          `${displayText(compareMeta?.storage_source)} @ ${formatAsOf(compareMeta?.as_of)}`,
        ].join(' | ')
      : ''

  const compareMarkdownTable =
    compareRows.length > 0
      ? [
          `### ${selectedAsset.symbol} 策略对比`,
          '',
          `- 排序指标: ${displayText(activeCompareRanking?.label)}`,
          `- 数据快照: ${displayText(compareMeta?.storage_source)} @ ${formatAsOf(compareMeta?.as_of)}`,
          '',
          '| 排名 | 策略 | 总收益 | 年化 | 夏普 | 最大回撤 | 胜率 | 成交数 |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |',
          ...compareRows.map((row, index) =>
            [
              index + 1,
              row.label,
              displayPercent(row.total_return, 2),
              displayPercent(row.annual_return, 2),
              displayFixed(row.sharpe_ratio, 2),
              displayPercent(row.max_drawdown, 2),
              displayPercent(row.win_rate, 2),
              displayLocaleNumber(row.trade_count),
            ].join(' | '),
          ).map((row) => `| ${row} |`),
        ].join('\n')
      : ''

  const handleCopyCompareSummary = async () => {
    if (!compareSummaryText || isCompareStale || !navigator.clipboard?.writeText) {
      setCompareCopyState('error')
      return
    }
    try {
      await navigator.clipboard.writeText(compareSummaryText)
      setCompareCopyState('done')
    } catch {
      setCompareCopyState('error')
    }
  }

  const handleCopyCompareBroadcast = async () => {
    if (!compareBroadcastText || isCompareStale || !navigator.clipboard?.writeText) {
      setCompareBroadcastCopyState('error')
      return
    }
    try {
      await navigator.clipboard.writeText(compareBroadcastText)
      setCompareBroadcastCopyState('done')
    } catch {
      setCompareBroadcastCopyState('error')
    }
  }

  const handleCopyCompareMarkdown = async () => {
    if (!compareMarkdownTable || isCompareStale || !navigator.clipboard?.writeText) {
      setCompareMarkdownCopyState('error')
      return
    }
    try {
      await navigator.clipboard.writeText(compareMarkdownTable)
      setCompareMarkdownCopyState('done')
    } catch {
      setCompareMarkdownCopyState('error')
    }
  }

  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      return undefined
    }
    const timer = window.setTimeout(() => {
      void loadChartPanel()
      void loadBacktestPanel()
    }, 150)
    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (allTrades.length > 0 && backtestTradesPage > backtestTradesPageCount) {
      setBacktestTradesPage(backtestTradesPageCount)
    }
  }, [allTrades.length, backtestTradesPage, backtestTradesPageCount, setBacktestTradesPage])

  useEffect(() => {
    if (!pendingBacktestStrategy || pendingBacktestStrategy !== strategyName) return
    setPendingBacktestStrategy(null)
    void runBacktestNow()
  }, [pendingBacktestStrategy, strategyName, runBacktestNow])

  useEffect(() => {
    if (!pendingCompareTemplateId) return
    setPendingCompareTemplateId(null)
    void runStrategyCompare()
  }, [pendingCompareTemplateId, runStrategyCompare])

  useEffect(() => {
    setCompareCopyState('idle')
    setCompareBroadcastCopyState('idle')
    setCompareMarkdownCopyState('idle')
  }, [compareBroadcastText, compareSummaryText, isCompareStale])

  useEffect(() => {
    setShowAllCompareSnapshots(false)
  }, [compareSnapshotFilter, selectedAsset.asset_type, selectedAsset.symbol])

  useEffect(() => {
    setSavedCompareTemplateFilter('asset')
  }, [selectedAsset.asset_type, selectedAsset.symbol])

  useEffect(() => {
    setShowCompareAdvancedTools(false)
  }, [selectedAsset.asset_type, selectedAsset.symbol])

  useEffect(() => {
    if (compareRows.length === 0) {
      setShowCompareReviewTools(false)
      lastSavedCompareSnapshotRef.current = null
    }
  }, [compareRows.length])

  useEffect(() => {
    if (!bestCompareRow || !currentCompareRow || isCompareStale) return
    const snapshotSignature = JSON.stringify({
      symbol: selectedAsset.symbol,
      assetType: selectedAsset.asset_type,
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
      bestStrategyName: bestCompareRow.strategy_name,
      currentRank: currentCompareRank >= 0 ? currentCompareRank + 1 : null,
      storageSource: compareMeta?.storage_source ?? null,
      asOf: compareMeta?.as_of ?? null,
    })
    if (lastSavedCompareSnapshotRef.current === snapshotSignature) return
    lastSavedCompareSnapshotRef.current = snapshotSignature

    const nextSnapshot: CompareSnapshotHistoryItem = {
      symbol: selectedAsset.symbol,
      assetType: selectedAsset.asset_type,
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
      bestStrategyName: bestCompareRow.strategy_name,
      bestStrategyLabel: bestCompareRow.label,
      currentRank: currentCompareRank >= 0 ? currentCompareRank + 1 : null,
      storageSource: compareMeta?.storage_source ?? null,
      asOf: compareMeta?.as_of ?? null,
      createdAt: new Date().toISOString(),
    }
    const nextHistory = [
      nextSnapshot,
      ...compareSnapshots.filter(
        (item) =>
          !(
            item.symbol === nextSnapshot.symbol &&
            item.assetType === nextSnapshot.assetType &&
            item.strategyName === nextSnapshot.strategyName &&
            item.compareRankingMetric === nextSnapshot.compareRankingMetric &&
            item.fast === nextSnapshot.fast &&
            item.slow === nextSnapshot.slow &&
            item.rsiPeriod === nextSnapshot.rsiPeriod &&
            item.oversold === nextSnapshot.oversold &&
            item.overbought === nextSnapshot.overbought &&
            item.initialCapital === nextSnapshot.initialCapital &&
            item.backtestStartDate === nextSnapshot.backtestStartDate &&
            item.backtestEndDate === nextSnapshot.backtestEndDate &&
            item.syncIfMissing === nextSnapshot.syncIfMissing &&
            item.bestStrategyName === nextSnapshot.bestStrategyName &&
            item.compareStrategyNames.length === nextSnapshot.compareStrategyNames.length &&
            item.compareStrategyNames.every((name, index) => nextSnapshot.compareStrategyNames[index] === name)
          ),
      ),
    ].slice(0, 12)
    persistCompareSnapshotHistory(nextHistory)
    setCompareSnapshots(nextHistory)
  }, [
    bestCompareRow,
    compareMeta?.as_of,
    compareMeta?.storage_source,
    compareRankingMetric,
    compareSnapshots,
    compareStrategyNames,
    currentCompareRank,
    currentCompareRow,
    fast,
    initialCapital,
    isCompareStale,
    overbought,
    oversold,
    backtestEndDate,
    backtestStartDate,
    rsiPeriod,
    selectedAsset.asset_type,
    selectedAsset.symbol,
    slow,
    strategyName,
    syncIfMissing,
  ])

  return (
    <section className="market-page">
      <WorkspaceHero
        onResetWorkspace={handleResetWorkspace}
      />
      <WorkspaceQuickNav />

      <div className="workspace-grid">
        <aside className="workspace-sidebar">
          <AssetSearchPanel
            searchScope={searchScope}
            searchInput={searchInput}
            searchLoading={searchLoading}
            searchError={searchError}
            searchResults={searchResults}
            showEmptyHint={searchResults.length === 0 && !searchLoading && deferredSearch.length > 0}
            onSearchScopeChange={setSearchScope}
            onSearchInputChange={setSearchInput}
            onApplyInput={handleApplyInput}
            onSelectAsset={handleSelectAsset}
          />

          <RecentAssetsPanel
            items={recentAssets}
            selectedAsset={selectedAsset}
            onSelect={handleSelectAsset}
            onClear={handleClearRecentAssets}
          />

          <WatchlistPanel
            items={watchlistAssets}
            selectedAsset={selectedAsset}
            onSelect={handleSelectAsset}
            onClear={clearWatchlistAssets}
            onExport={exportWatchlistCsv}
          />

          <WatchlistSnapshotPanel
            rows={watchlistQuoteRows}
            loading={loadingWatchlistQuotes}
            error={watchlistQuoteError}
            selectedAsset={selectedAsset}
            onSelect={handleSelectAsset}
          />

          <MoversPanel
            title="股票动量"
            subtitle="快速切换到当下最活跃标的"
            rows={stockMovers}
            meta={stockMoversMeta}
            error={moversError}
            assetType="stock"
            onSelect={handleSelectMover}
          />

          <MoversPanel
            title="加密动量"
            subtitle="把价格驱动型资产放在同一观察面板"
            rows={cryptoMovers}
            meta={cryptoMoversMeta}
            error={moversError}
            assetType="crypto"
            onSelect={handleSelectMover}
          />

          <RuntimeModePanel
            health={health}
            error={healthError}
            observability={observability}
            observabilityError={observabilityError}
            frontendPerformance={frontendPerformance}
            cacheMaintenance={cacheMaintenance}
            cacheMaintenanceError={cacheMaintenanceError}
          />
        </aside>

        <div className="workspace-main">
          <div id="workspace-overview" className="workspace-anchor">
            <AssetOverviewPanel
              selectedAsset={selectedAsset}
              quoteText={quoteText}
              quoteSource={quoteSource}
              klineSource={klineSource}
              chartStartDate={chartStartDate}
              chartEndDate={chartEndDate}
              loadingHistory={loadingHistory}
              historyStatus={historyStatus}
              backtestMeta={backtestMeta}
              marketMeta={marketMeta}
              marketError={marketError}
              historyError={historyError}
              quoteAsOf={quote?.as_of}
              syncingHistory={syncingHistory}
              watchlisted={isWatchlisted(selectedAsset)}
              onRefreshChart={refreshChart}
              onSyncHistory={syncHistoryNow}
              onToggleWatchlist={() => toggleWatchlist(selectedAsset)}
            />
          </div>

          <div id="workspace-chart" className="workspace-anchor">
            <Suspense
              fallback={(
                <PanelLoadingFallback
                  title="实时行情与 K 线"
                  description="图表模块按需加载，避免首屏把 chart runtime 一起塞进入口包。"
                />
              )}
            >
              <ChartPanel
                selectedAsset={selectedAsset}
                period={period}
                chartStartDate={chartStartDate}
                chartEndDate={chartEndDate}
                marketMeta={marketMeta}
                quoteAsOf={quote?.as_of}
                historyStatus={historyStatus}
                chartStateText={chartStateText}
                selectedIndicators={selectedIndicators}
                candles={candles}
                onPeriodChange={setPeriod}
                onChartStartDateChange={setChartStartDate}
                onChartEndDateChange={setChartEndDate}
                onSelectPreset={applyChartPreset}
                onToggleIndicator={toggleIndicator}
              />
            </Suspense>
          </div>

          <div id="workspace-backtest" className="workspace-anchor">
            <section className="workspace-panel">
              <div className="panel-head">
                <h3>策略对比池</h3>
                <span>当前策略固定纳入，对比会直接读取这里的候选池。</span>
              </div>
              <div className="compare-journey-card">
                <div className="compare-journey-head">
                  <small>新手流程</small>
                  <strong>先确认当前策略，再扩大候选池，最后根据结果决定是否切换。</strong>
                  <p>第一次只看标记为“下一步”的步骤。导出、历史快照和手动调池都收在后面。</p>
                </div>
                <div className="compare-journey-grid">
                  {compareJourneySteps.map((step) => (
                    <section key={step.key} className={`compare-journey-step compare-journey-step-${step.status}`}>
                      <div className="compare-journey-step-head">
                        <span className={`compare-journey-status compare-journey-status-${step.status}`}>
                          {getCompareJourneyStatusLabel(step.status)}
                        </span>
                        <strong>{step.title}</strong>
                      </div>
                      <p>{step.detail}</p>
                      {step.action ? (
                        <button
                          className={step.status === 'active' ? 'primary-btn' : 'secondary-btn'}
                          type="button"
                          onClick={step.action.onClick}
                          disabled={step.action.disabled}
                        >
                          {step.action.label}
                        </button>
                      ) : null}
                    </section>
                  ))}
                </div>
              </div>
              <div className="asset-badges compare-pool-overview">
                <span className="asset-chip">当前策略 {currentStrategyLabel}</span>
                <span className="asset-chip asset-chip-quiet">候选池 {displayLocaleNumber(comparePoolSize)} 策</span>
                <span className="asset-chip asset-chip-quiet">模板 {activeCompareTemplateLabel}</span>
                <span className="asset-chip asset-chip-quiet">排序 {displayText(activeCompareRanking?.label)}</span>
              </div>
              {trendCompareTemplate && !hasFreshCompare ? (
                <p className="panel-copy">想先看一组更聚焦的候选时，可以直接点下方“趋势池”模板再运行对比。</p>
              ) : (
                <p className="panel-copy">第一次上手时，不用手动改候选池；默认模板或核心池已经够用。</p>
              )}
              <div className="form-row">
                <span className="panel-copy">对比模板</span>
                {COMPARE_STRATEGY_TEMPLATES.map((template) => (
                  <button
                    key={template.value}
                    className={isCompareTemplateActive(template.strategies) ? 'chip chip-active' : 'chip'}
                    type="button"
                    onClick={() => handleApplyCompareTemplate(template.strategies)}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
              <div className="form-row">
                <label className="panel-copy" htmlFor="compare-ranking-metric">对比排序</label>
                <select
                  id="compare-ranking-metric"
                  className="text-input"
                  value={compareRankingMetric}
                  onChange={(event) => setCompareRankingMetric(event.target.value as typeof compareRankingMetric)}
                >
                  {COMPARE_RANKING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="compare-advanced-panel">
                <div className="form-row">
                  <span className="panel-copy">进阶工具</span>
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => setShowCompareAdvancedTools((value) => !value)}
                  >
                    {showCompareAdvancedTools ? '收起进阶工具' : '展开进阶工具'}
                  </button>
                </div>
                {showCompareAdvancedTools ? (
                  <div className="compare-advanced-stack">
                    <div className="compare-advanced-section">
                      <span className="panel-copy">手动候选池</span>
                      <div className="compare-chip-grid">
                        {BACKTEST_STRATEGIES.map((strategy) => {
                          const isCurrent = strategy.value === strategyName
                          const isActive = isCurrent || compareStrategyNames.includes(strategy.value)

                          return (
                            <button
                              key={strategy.value}
                              className={isActive ? 'chip chip-active' : 'chip'}
                              type="button"
                              disabled={isCurrent}
                              onClick={() => handleToggleCompareStrategy(strategy.value)}
                            >
                              {strategy.label}
                            </button>
                          )
                        })}
                      </div>
                      {compareUndoSnapshot ? (
                        <div className="form-row">
                          <button className="secondary-btn" type="button" onClick={handleUndoCompareAdjustment}>
                            撤销上一步调整
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="compare-advanced-section">
                      <div className="form-row">
                        <span className="panel-copy">自定义模板</span>
                        <button className="secondary-btn" type="button" onClick={handleSaveCompareTemplate}>
                          保存当前配置为模板
                        </button>
                        <button className="secondary-btn" type="button" onClick={() => void handleCopySavedCompareTemplates()}>
                          复制模板JSON
                        </button>
                        <button className="secondary-btn" type="button" onClick={handleImportSavedCompareTemplates}>
                          导入模板JSON
                        </button>
                      </div>
                      {compareTemplateCopyState === 'done' ? <p className="ok-text">模板JSON已复制。</p> : null}
                      {compareTemplateCopyState === 'error' ? <p className="warn-text">当前环境无法复制模板JSON。</p> : null}
                      {compareTemplateImportState === 'done' ? <p className="ok-text">模板JSON已导入。</p> : null}
                      {compareTemplateImportState === 'error' ? <p className="warn-text">模板JSON无效，无法导入。</p> : null}
                      {savedCompareTemplates.length > 0 ? (
                        <>
                          <div className="compare-template-toolbar">
                            <button
                              className={savedCompareTemplateFilter === 'asset' ? 'chip chip-active' : 'chip'}
                              type="button"
                              onClick={() => setSavedCompareTemplateFilter('asset')}
                            >
                              当前标的 {displayLocaleNumber(assetSavedCompareTemplates.length)}
                            </button>
                            <button
                              className={savedCompareTemplateFilter === 'all' ? 'chip chip-active' : 'chip'}
                              type="button"
                              onClick={() => setSavedCompareTemplateFilter('all')}
                            >
                              全部 {displayLocaleNumber(savedCompareTemplates.length)}
                            </button>
                          </div>
                          {isSavedCompareTemplateFallbackToAll ? (
                            <p className="panel-copy">当前标的还没有自定义模板，已先展示全部模板。</p>
                          ) : null}
                          {visibleSavedCompareTemplates.length === 0 ? (
                            <p className="panel-copy">当前还没有可用的自定义模板。</p>
                          ) : null}
                          <div className="compare-template-list">
                            {visibleSavedCompareTemplates.map((template) => (
                              <div key={template.id} className="compare-template-card">
                                <button
                                  className="compare-template-apply"
                                  type="button"
                                  onClick={() => handleApplySavedCompareTemplate(template)}
                                >
                                  应用模板 {template.label}
                                </button>
                                <span className="panel-copy">
                                  标的 {displayText(template.symbol)} | 排序 {getCompareRankingLabel(template.compareRankingMetric)} | 候选{' '}
                                  {displayLocaleNumber(template.compareStrategyNames.length + 1)}
                                </span>
                                <div className="compare-template-actions">
                                  <button
                                    className="secondary-btn"
                                    type="button"
                                    onClick={() => handleApplySavedCompareTemplate(template, { runCompare: true })}
                                  >
                                    应用并对比
                                  </button>
                                  <button
                                    className="secondary-btn"
                                    type="button"
                                    onClick={() => handleRenameSavedCompareTemplate(template)}
                                    aria-label={`重命名自定义模板 ${template.label}`}
                                  >
                                    重命名
                                  </button>
                                  <button
                                    className="compare-template-remove"
                                    type="button"
                                    onClick={() => handleDeleteSavedCompareTemplate(template)}
                                    aria-label={`删除自定义模板 ${template.label}`}
                                  >
                                    删除
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="panel-copy">还没有自定义模板，保存一次当前 compare pool 后会出现在这里。</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="panel-copy">手动候选池、自定义模板和历史快照都在这里，需要时再展开。</p>
                )}
              </div>
              {compareRows.length > 0 ? (
                <div className="summary-grid">
                  <div className="summary-card">
                    <small>对比策略数</small>
                    <strong>{displayLocaleNumber(compareRows.length)}</strong>
                  </div>
                  <div className="summary-card">
                    <small>当前策略排名</small>
                    <strong>
                      {currentCompareRank >= 0 ? `#${currentCompareRank + 1} / ${compareRows.length}` : '-'}
                    </strong>
                  </div>
                  <div className="summary-card">
                    <small>最佳策略</small>
                    <strong>{compareRows[0]?.label ?? '-'}</strong>
                  </div>
                  <div className="summary-card">
                    <small>当前{activeCompareRanking?.label ?? '指标'}</small>
                    <strong>{activeCompareMetricValue}</strong>
                  </div>
                  <div className="summary-card">
                    <small>距最优{activeCompareRanking?.label ?? '指标'}</small>
                    <strong>{compareGapValue === null ? '-' : formatCompareMetric(compareRankingMetric, compareGapValue)}</strong>
                  </div>
                  <div className="summary-card">
                    <small>相对 Buy&Hold 总收益</small>
                    <strong>{buyHoldTotalReturnDelta === null ? '-' : displayPercent(buyHoldTotalReturnDelta, 2)}</strong>
                  </div>
                </div>
              ) : null}
              {compareRows.length > 0 ? (
                <p className="panel-copy">
                  对比快照: {displayText(compareMeta?.storage_source)} | 排序: {displayText(activeCompareRanking?.label)} | 时间:{' '}
                  {formatAsOf(compareMeta?.as_of)}
                </p>
              ) : null}
              {compareDecision ? (
                <div className="compare-decision-card">
                  <small>对比结论</small>
                  <strong>{compareDecision.title}</strong>
                  <p>{compareDecision.detail}</p>
                  {compareDecisionPrimaryAction || compareDecisionSecondaryAction ? (
                    <div className="compare-decision-actions">
                      {compareDecisionPrimaryAction ? (
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={compareDecisionPrimaryAction.onClick}
                          disabled={compareDecisionPrimaryAction.disabled}
                        >
                          {compareDecisionPrimaryAction.label}
                        </button>
                      ) : null}
                      {compareDecisionSecondaryAction ? (
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={compareDecisionSecondaryAction.onClick}
                          disabled={compareDecisionSecondaryAction.disabled}
                        >
                          {compareDecisionSecondaryAction.label}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {showCompareAdvancedTools && compareSnapshots.length > 0 ? (
                <div className="form-row compare-snapshot-section compare-advanced-section">
                  <span className="panel-copy">最近对比</span>
                  <div className="compare-snapshot-toolbar">
                    <button
                      className={compareSnapshotFilter === 'asset' ? 'chip chip-active' : 'chip'}
                      type="button"
                      onClick={() => setCompareSnapshotFilter('asset')}
                    >
                      当前标的 {displayLocaleNumber(assetCompareSnapshots.length)}
                    </button>
                    <button
                      className={compareSnapshotFilter === 'all' ? 'chip chip-active' : 'chip'}
                      type="button"
                      onClick={() => setCompareSnapshotFilter('all')}
                    >
                      全部 {displayLocaleNumber(compareSnapshots.length)}
                    </button>
                    {compareSnapshotPool.length > 3 ? (
                      <button
                        className="secondary-btn"
                        type="button"
                        onClick={() => setShowAllCompareSnapshots((value) => !value)}
                      >
                        {showAllCompareSnapshots
                          ? '收起历史'
                          : `展开全部 ${displayLocaleNumber(compareSnapshotPool.length)}`}
                      </button>
                    ) : null}
                  </div>
                  {isCompareSnapshotFallbackToAll ? (
                    <p className="panel-copy">当前标的还没有最近对比，已先展示全部历史。</p>
                  ) : null}
                  {compareSnapshotPool.length === 0 ? (
                    <p className="panel-copy">当前还没有最近对比历史。</p>
                  ) : null}
                  <div className="compare-snapshot-list">
                    {recentCompareSnapshots.map((snapshot) => {
                      const rankingLabel = getCompareRankingLabel(snapshot.compareRankingMetric)
                      const currentRankLabel =
                        snapshot.currentRank && snapshot.currentRank > 0
                          ? `当前 #${snapshot.currentRank} / ${snapshot.compareStrategyNames.length + 1}`
                          : '未记录当前排名'
                      return (
                        <div key={getCompareSnapshotKey(snapshot)} className="compare-snapshot-card">
                          <button
                            className="compare-snapshot-button"
                            type="button"
                            onClick={() => handleRestoreCompareSnapshot(snapshot)}
                          >
                            <span className="compare-snapshot-title">
                              恢复 {snapshot.symbol} / {snapshot.bestStrategyLabel} / {rankingLabel}
                            </span>
                            <span className="compare-snapshot-meta">
                              <span className="asset-chip">{currentRankLabel}</span>
                              <span className="asset-chip asset-chip-quiet">来源 {displayText(snapshot.storageSource)}</span>
                              <span className="asset-chip asset-chip-quiet">时间 {formatAsOf(snapshot.asOf)}</span>
                            </span>
                          </button>
                          <button
                            className="compare-snapshot-remove"
                            type="button"
                            onClick={() => handleDeleteCompareSnapshot(snapshot)}
                            aria-label={`删除最近对比快照 ${snapshot.symbol} / ${snapshot.bestStrategyLabel} / ${rankingLabel}`}
                          >
                            删除
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <button className="secondary-btn" type="button" onClick={handleClearCompareSnapshots}>
                    清空最近对比
                  </button>
                </div>
              ) : null}
              {topCompareCandidates.length > 0 && !isCompareStale ? (
                <div className="form-row">
                  <span className="panel-copy">快捷切换</span>
                  {topCompareCandidates.map((row) => (
                    <button
                      key={row.strategy_name}
                      className="secondary-btn"
                      type="button"
                      onClick={() => handleAdoptCompareStrategy(row.strategy_name)}
                    >
                      {getCandidateShortcutLabel(row.strategy_name)}
                    </button>
                  ))}
                </div>
              ) : null}
              {previousStrategyName && previousStrategyName !== strategyName ? (
                <div className="form-row">
                  <button
                    className="secondary-btn"
                    type="button"
                    onClick={() => handleStrategyChange(previousStrategyName)}
                  >
                    回到上一主策略: {previousStrategyLabel}
                  </button>
                </div>
              ) : null}
              {isCompareStale ? <p className="warn-text">当前对比结果基于旧参数，需重新运行对比。</p> : null}
              {isBacktestStale ? <p className="warn-text">当前回测结果基于旧参数，需重新运行当前回测。</p> : null}
              {isCompareStale || isBacktestStale ? (
                <div className="form-row">
                  {isCompareStale ? (
                    <button className="secondary-btn" type="button" onClick={runStrategyCompare} disabled={loadingCompare}>
                      {loadingCompare ? '对比中...' : '重跑对比'}
                    </button>
                  ) : null}
                  {isBacktestStale ? (
                    <button className="secondary-btn" type="button" onClick={runBacktestNow} disabled={loadingBacktest}>
                      {loadingBacktest ? '回测中...' : '重跑当前回测'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {compareRows.length > 0 ? (
                <div className="compare-review-panel">
                  <div className="form-row">
                    <span className="panel-copy">复盘与导出</span>
                    <button
                      className="secondary-btn"
                      type="button"
                      onClick={() => setShowCompareReviewTools((value) => !value)}
                    >
                      {showCompareReviewTools ? '收起复盘工具' : '展开复盘工具'}
                    </button>
                  </div>
                  {showCompareReviewTools ? (
                    <>
                      <p className="panel-copy">导出、复制、批量缩池和手动设主策略都在这里，新手可以先不用展开。</p>
                      <div className="form-row compare-review-actions">
                        <button className="secondary-btn" type="button" onClick={exportCompareJson} disabled={compareRows.length === 0 || isCompareStale}>
                          对比JSON
                        </button>
                        <button className="secondary-btn" type="button" onClick={() => void handleCopyCompareSummary()} disabled={compareRows.length === 0 || isCompareStale}>
                          复制对比摘要
                        </button>
                        <button className="secondary-btn" type="button" onClick={() => void handleCopyCompareBroadcast()} disabled={compareRows.length === 0 || isCompareStale}>
                          复制播报文案
                        </button>
                        <button className="secondary-btn" type="button" onClick={() => void handleCopyCompareMarkdown()} disabled={compareRows.length === 0 || isCompareStale}>
                          复制Markdown表格
                        </button>
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={handleKeepTopCompareCandidates}
                          disabled={compareRows.length === 0 || isCompareStale}
                        >
                          保留前三候选
                        </button>
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={handleKeepBetterCompareCandidates}
                          disabled={compareRows.length === 0 || isCompareStale || currentCompareRank <= 0}
                        >
                          仅保留优于当前
                        </button>
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={() => bestCompareRow ? handleAdoptCompareStrategy(bestCompareRow.strategy_name) : undefined}
                          disabled={!bestCompareRow || isCompareStale || bestCompareRow.strategy_name === strategyName}
                        >
                          设为当前策略
                        </button>
                        <button
                          className="secondary-btn"
                          type="button"
                          onClick={() => bestCompareRow ? handleAdoptCompareStrategy(bestCompareRow.strategy_name, { runBacktest: true }) : undefined}
                          disabled={!bestCompareRow || isCompareStale || bestCompareRow.strategy_name === strategyName || loadingBacktest}
                        >
                          设为当前并回测
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="panel-copy">导出 JSON、复制复盘文案、批量缩池和手动设主策略都收在这里，需要时再展开。</p>
                  )}
                </div>
              ) : null}
              {compareCopyState === 'done' ? <p className="ok-text">对比摘要已复制。</p> : null}
              {compareCopyState === 'error' ? <p className="warn-text">当前环境无法复制对比摘要。</p> : null}
              {compareBroadcastCopyState === 'done' ? <p className="ok-text">对比播报文案已复制。</p> : null}
              {compareBroadcastCopyState === 'error' ? <p className="warn-text">当前环境无法复制对比播报文案。</p> : null}
              {compareMarkdownCopyState === 'done' ? <p className="ok-text">对比Markdown已复制。</p> : null}
              {compareMarkdownCopyState === 'error' ? <p className="warn-text">当前环境无法复制对比Markdown。</p> : null}
            </section>
            <Suspense
              fallback={(
                <PanelLoadingFallback
                  title="单标的回测"
                  description="回测模块按需加载，避免首屏把 equity chart 和策略表单一起塞进入口包。"
                />
              )}
            >
              <BacktestPanel
                selectedSymbol={selectedAsset.symbol}
                selectedAssetType={selectedAsset.asset_type}
                strategyName={strategyName}
                fast={fast}
                slow={slow}
                rsiPeriod={rsiPeriod}
                oversold={oversold}
                overbought={overbought}
                initialCapital={initialCapital}
                backtestStartDate={backtestStartDate}
                backtestEndDate={backtestEndDate}
                syncIfMissing={syncIfMissing}
                backtestTradesPage={backtestTradesPage}
                backtestTradesTotal={allTrades.length}
                backtestTradesPageCount={backtestTradesPageCount}
                loadingBacktest={loadingBacktest}
                loadingCompare={loadingCompare}
                backtestError={backtestError}
                compareError={compareError}
                isBacktestStale={isBacktestStale}
                isCompareStale={isCompareStale}
                backtestResult={backtestResult}
                backtestMeta={backtestMeta}
                compareRows={compareRows}
                trades={trades}
                onStrategyChange={handleStrategyChange}
                onFastChange={setFast}
                onSlowChange={setSlow}
                onRsiPeriodChange={setRsiPeriod}
                onOversoldChange={setOversold}
                onOverboughtChange={setOverbought}
                onInitialCapitalChange={setInitialCapital}
                onBacktestStartDateChange={setBacktestStartDate}
                onBacktestEndDateChange={setBacktestEndDate}
                onSyncIfMissingChange={setSyncIfMissing}
                onBacktestTradesPageChange={setBacktestTradesPage}
                onRunBacktest={runBacktestNow}
                onRunCompare={runStrategyCompare}
                onPresetSelect={applyBacktestPreset}
                onExportBacktestJson={exportBacktestJson}
                onExportCompareCsv={exportCompareCsv}
                onExportEquityCurve={exportEquityCurveCsv}
                onExportTrades={exportTradesCsv}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  )
}
