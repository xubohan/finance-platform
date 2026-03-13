import { useState } from 'react'

import { displayLocaleNumber, displayPercent, displayText } from '../../utils/display'
import type { SearchAsset } from '../../api/market'
import type { WatchlistQuoteRow } from '../../hooks/useWatchlistQuotes'

type Props = {
  rows: WatchlistQuoteRow[]
  loading: boolean
  error: string | null
  selectedAsset: SearchAsset
  onSelect: (asset: SearchAsset) => void
}

export default function WatchlistSnapshotPanel({
  rows,
  loading,
  error,
  selectedAsset,
  onSelect,
}: Props) {
  const [mode, setMode] = useState<'price' | 'relative'>('price')
  const baseline =
    rows.find(
      (asset) =>
        asset.symbol === selectedAsset.symbol &&
        asset.asset_type === selectedAsset.asset_type &&
        typeof asset.price === 'number',
    ) ?? rows.find((asset) => typeof asset.price === 'number')

  const relativeLabel = baseline ? `相对 ${baseline.symbol}` : '相对当前'

  const relativeDelta = (asset: WatchlistQuoteRow) => {
    if (!baseline?.price || !asset.price) return undefined
    if (baseline.symbol === asset.symbol && baseline.asset_type === asset.asset_type) return 0
    return ((asset.price / baseline.price) - 1) * 100
  }

  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <h3>自选快照</h3>
        <span>对比当前关注标的的最新价格与涨跌</span>
      </div>
      {rows.length > 1 ? (
        <div className="preset-bar">
          <button
            className={mode === 'price' ? 'chip chip-active' : 'chip'}
            type="button"
            onClick={() => setMode('price')}
          >
            价格模式
          </button>
          <button
            className={mode === 'relative' ? 'chip chip-active' : 'chip'}
            type="button"
            onClick={() => setMode('relative')}
          >
            对比模式
          </button>
        </div>
      ) : null}
      {error ? <p className="warn-text">{error}</p> : null}
      {loading ? <p className="panel-copy">快照刷新中...</p> : null}
      {rows.length === 0 ? <p className="panel-copy">自选列表为空时不会加载快照。</p> : null}
      {mode === 'relative' ? (
        <p className="panel-copy">对比基准: {displayText(baseline?.symbol, '未找到可比基准')}</p>
      ) : null}
      <div className="snapshot-list">
        {rows.map((asset) => (
          <button
            key={`${asset.asset_type}-${asset.symbol}`}
            className={
              asset.symbol === selectedAsset.symbol && asset.asset_type === selectedAsset.asset_type
                ? 'snapshot-row snapshot-row-active'
                : 'snapshot-row'
            }
            type="button"
            onClick={() => onSelect(asset)}
          >
            <strong>{asset.symbol}</strong>
            <span>{displayLocaleNumber(asset.price)}</span>
            <span>
              {mode === 'relative'
                ? `${displayPercent(relativeDelta(asset), 2)} vs ${displayText(baseline?.symbol)}`
                : displayPercent(asset.change_pct_24h, 2)}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
