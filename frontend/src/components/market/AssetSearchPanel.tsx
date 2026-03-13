import type { SearchAsset, SearchAssetType } from '../../api/market'
import { displayText } from '../../utils/display'

type Props = {
  searchScope: SearchAssetType
  searchInput: string
  searchLoading: boolean
  searchError: string | null
  searchResults: SearchAsset[]
  showEmptyHint: boolean
  onSearchScopeChange: (scope: SearchAssetType) => void
  onSearchInputChange: (value: string) => void
  onApplyInput: () => void
  onSelectAsset: (asset: SearchAsset) => void
}

export default function AssetSearchPanel({
  searchScope,
  searchInput,
  searchLoading,
  searchError,
  searchResults,
  showEmptyHint,
  onSearchScopeChange,
  onSearchInputChange,
  onApplyInput,
  onSelectAsset,
}: Props) {
  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <h3>标的搜索</h3>
        <span>从单一入口切换工作对象</span>
      </div>
      <div className="stack-gap">
        <div className="form-row">
          <select
            className="text-input"
            value={searchScope}
            onChange={(event) => onSearchScopeChange(event.target.value as SearchAssetType)}
          >
            <option value="all">全部</option>
            <option value="stock">股票</option>
            <option value="crypto">加密</option>
          </select>
          <input
            className="text-input flex-input"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value.toUpperCase())}
            placeholder="输入代码或名称，例如 AAPL / 600519.SH / BTC"
          />
          <button className="primary-btn" type="button" onClick={onApplyInput}>
            切换
          </button>
        </div>
        <p className="panel-copy">搜索结果来自实时股票标的列表与本地加密资产表。直接输入代码也能快速切换。</p>
        {searchError ? <p className="warn-text">{searchError}</p> : null}
        {searchLoading ? <p className="panel-copy">搜索中...</p> : null}
        <div className="search-results">
          {showEmptyHint ? <p className="empty-hint">没有命中结果，可以直接用输入框切换。</p> : null}
          {searchResults.map((asset) => (
            <button
              key={`${asset.asset_type}-${asset.symbol}`}
              className="search-result"
              type="button"
              onClick={() => onSelectAsset(asset)}
            >
              <span>
                <strong>{asset.symbol}</strong>
                <small>{displayText(asset.name)}</small>
              </span>
              <span className="asset-chip">
                {asset.asset_type.toUpperCase()}
                {asset.market ? ` · ${asset.market}` : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
