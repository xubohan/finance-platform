import type { SearchAsset } from '../../api/market'
import type { BacktestRunMeta } from '../../api/backtest'
import { displayLocaleNumber, displayText } from '../../utils/display'
import { formatAsOf } from '../../utils/time'

type HistoryStatus = {
  has_data: boolean
  local_rows: number
}

type MarketMeta = {
  quote?: { as_of?: string | null }
  kline?: { as_of?: string | null }
}

type Props = {
  selectedAsset: SearchAsset
  quoteText: string
  quoteSource: string
  klineSource: string
  chartStartDate: string
  chartEndDate: string
  loadingHistory: boolean
  historyStatus: HistoryStatus | null
  backtestMeta: BacktestRunMeta | null
  marketMeta: MarketMeta
  marketError: string | null
  historyError: string | null
  quoteAsOf?: string | null
  syncingHistory: boolean
  watchlisted: boolean
  onRefreshChart: () => void
  onSyncHistory: () => void
  onToggleWatchlist: () => void
}

export default function AssetOverviewPanel({
  selectedAsset,
  quoteText,
  quoteSource,
  klineSource,
  chartStartDate,
  chartEndDate,
  loadingHistory,
  historyStatus,
  backtestMeta,
  marketMeta,
  marketError,
  historyError,
  quoteAsOf,
  syncingHistory,
  watchlisted,
  onRefreshChart,
  onSyncHistory,
  onToggleWatchlist,
}: Props) {
  return (
    <section className="workspace-panel asset-panel">
      <div className="asset-header">
        <div>
          <p className="eyebrow">Current Target</p>
          <h3>{displayText(selectedAsset.name)}</h3>
          <p className="asset-meta">
            {selectedAsset.symbol} · {selectedAsset.asset_type.toUpperCase()} · {displayText(selectedAsset.market)}
          </p>
        </div>
        <div className="asset-actions">
          <div className="asset-badges">
            <span className="asset-chip">{selectedAsset.asset_type.toUpperCase()}</span>
            <span className="asset-chip asset-chip-quiet">{displayText(selectedAsset.market)}</span>
            <button className="chip" type="button" onClick={onToggleWatchlist}>
              {watchlisted ? '移出自选' : '加入自选'}
            </button>
          </div>
          <div className="form-row">
            <button className="secondary-btn" type="button" onClick={onRefreshChart}>
              刷新数据
            </button>
            <button className="secondary-btn" type="button" onClick={onSyncHistory} disabled={syncingHistory}>
              {syncingHistory ? '同步历史中...' : '同步本地历史'}
            </button>
          </div>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <small>最新报价</small>
          <strong>{quoteText}</strong>
        </div>
        <div className="summary-card">
          <small>Quote Source</small>
          <strong>{quoteSource}</strong>
        </div>
        <div className="summary-card">
          <small>K 线状态</small>
          <strong>{loadingHistory ? '同步中' : `${displayLocaleNumber(historyStatus?.local_rows)} rows`}</strong>
        </div>
        <div className="summary-card">
          <small>Kline Source</small>
          <strong>{klineSource}</strong>
        </div>
      </div>

      <div className="status-grid">
        <div className="status-row">
          <span>报价时间</span>
          <strong>{formatAsOf(quoteAsOf ?? marketMeta.quote?.as_of)}</strong>
        </div>
        <div className="status-row">
          <span>K 线时间</span>
          <strong>{formatAsOf(marketMeta.kline?.as_of)}</strong>
        </div>
        <div className="status-row">
          <span>K 线区间</span>
          <strong>
            {chartStartDate} ~ {chartEndDate}
          </strong>
        </div>
        <div className="status-row">
          <span>本地历史覆盖</span>
          <strong>
            {loadingHistory
              ? '检查中'
              : historyStatus?.has_data
                ? `${displayLocaleNumber(historyStatus.local_rows)} rows`
                : '未同步'}
          </strong>
        </div>
        <div className="status-row">
          <span>回测数据源</span>
          <strong>{displayText(backtestMeta?.storage_source ?? backtestMeta?.ohlcv_source ?? backtestMeta?.source)}</strong>
        </div>
      </div>
      {marketError ? <p className="warn-text">{marketError}</p> : null}
      {historyError ? <p className="warn-text">{historyError}</p> : null}
    </section>
  )
}
