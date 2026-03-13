import type { SearchAsset } from '../../api/market'
import { displayText } from '../../utils/display'

type Props = {
  items: SearchAsset[]
  selectedAsset: SearchAsset
  onSelect: (asset: SearchAsset) => void
  onClear: () => void
}

export default function RecentAssetsPanel({ items, selectedAsset, onSelect, onClear }: Props) {
  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <h3>最近访问</h3>
        <span>保留你最近切换过的工作对象</span>
      </div>
      {items.length > 0 ? (
        <div className="form-row">
          <button className="secondary-btn" type="button" onClick={onClear}>
            清空最近访问
          </button>
        </div>
      ) : null}
      {items.length === 0 ? <p className="panel-copy">还没有最近访问标的。</p> : null}
      <div className="search-results">
        {items.map((asset) => (
          <button
            key={`${asset.asset_type}-${asset.symbol}`}
            className={
              asset.symbol === selectedAsset.symbol && asset.asset_type === selectedAsset.asset_type
                ? 'search-result search-result-active'
                : 'search-result'
            }
            type="button"
            onClick={() => onSelect(asset)}
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
    </section>
  )
}
