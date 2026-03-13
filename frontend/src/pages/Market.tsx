import {
  type AssetType,
  type SearchAsset,
} from '../api/market'
import AssetOverviewPanel from '../components/market/AssetOverviewPanel'
import AssetSearchPanel from '../components/market/AssetSearchPanel'
import BacktestPanel from '../components/market/BacktestPanel'
import ChartPanel from '../components/market/ChartPanel'
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
import { useWatchlistQuotes } from '../hooks/useWatchlistQuotes'
import { useWorkspaceDiscovery } from '../hooks/useWorkspaceDiscovery'
import { useWorkspaceStorage } from '../hooks/useWorkspaceStorage'
import { displayLocaleNumber, displayPercent } from '../utils/display'

export default function MarketPage() {
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
    runBacktestNow,
    clearBacktestState,
    exportBacktestJson,
    exportEquityCurveCsv,
    exportTradesCsv,
  } = useBacktestWorkspace({
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
  })

  const handleSelectAsset = (asset: SearchAsset) => {
    rememberAsset(asset)
    selectAsset(asset)
    clearSearchResults()
    clearBacktestState()
  }

  const handleApplyInput = () => {
    const asset = applyInputAsset()
    if (!asset) return
    rememberAsset(asset)
    clearSearchResults()
    clearBacktestState()
  }

  const handleSelectMover = (symbol: string, assetType: AssetType) => {
    const asset = selectMoverAsset(symbol, assetType)
    rememberAsset(asset)
    clearBacktestState()
  }

  const handleClearRecentAssets = () => {
    clearRecentAssets()
  }

  const handleResetWorkspace = () => {
    resetWorkspace()
    clearSearchResults()
    clearBacktestState()
    refreshChart()
  }

  const trades = backtestResult?.trades?.slice(-8).reverse() ?? []
  const quoteText =
    quote && Number.isFinite(Number(quote.price))
      ? `${displayLocaleNumber(quote.price)} (${displayPercent(quote.change_pct_24h, 2)})`
      : loadingQuote
        ? '报价加载中...'
        : '-'

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

          <RuntimeModePanel health={health} error={healthError} />
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
          </div>

          <div id="workspace-backtest" className="workspace-anchor">
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
              loadingBacktest={loadingBacktest}
              backtestError={backtestError}
              backtestResult={backtestResult}
              backtestMeta={backtestMeta}
              trades={trades}
              onStrategyChange={setStrategyName}
              onFastChange={setFast}
              onSlowChange={setSlow}
              onRsiPeriodChange={setRsiPeriod}
              onOversoldChange={setOversold}
              onOverboughtChange={setOverbought}
              onInitialCapitalChange={setInitialCapital}
              onBacktestStartDateChange={setBacktestStartDate}
              onBacktestEndDateChange={setBacktestEndDate}
              onSyncIfMissingChange={setSyncIfMissing}
              onRunBacktest={runBacktestNow}
              onPresetSelect={applyBacktestPreset}
              onExportBacktestJson={exportBacktestJson}
              onExportEquityCurve={exportEquityCurveCsv}
              onExportTrades={exportTradesCsv}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
