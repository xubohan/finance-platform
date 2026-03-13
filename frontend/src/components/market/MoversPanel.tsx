import type { AssetType, TopMoverRow, TopMoversMeta } from '../../api/market'
import { displayLocaleNumber, displayPercent, displayText } from '../../utils/display'
import { formatAsOf } from '../../utils/time'

function describeCacheAge(value?: number | null): string {
  if (typeof value !== 'number' || value < 0) return '-'
  if (value < 60) return `${value}s`
  if (value < 3600) return `${Math.round(value / 60)}m`
  return `${Math.round(value / 3600)}h`
}

function describeSource(meta?: TopMoversMeta | null): string {
  if (!meta?.source) return '-'
  if (meta.source === 'cache') return '缓存'
  if (meta.source === 'live') return '实时'
  return '混合'
}

function describeFreshness(meta?: TopMoversMeta | null): string {
  if (!meta?.source) return '-'
  if (meta.source === 'cache') {
    return meta.stale ? '过期缓存' : '新鲜缓存'
  }
  if (meta.source === 'live') return '实时'
  return '混合'
}

type Props = {
  title: string
  subtitle: string
  rows: TopMoverRow[]
  meta?: TopMoversMeta | null
  error?: string | null
  assetType: AssetType
  onSelect: (symbol: string, assetType: AssetType) => void
}

export default function MoversPanel({ title, subtitle, rows, meta, error, assetType, onSelect }: Props) {
  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      {meta?.source ? (
        <p className="panel-copy movers-meta">
          来源: {describeSource(meta)} | 新鲜度: {describeFreshness(meta)} | 更新时间: {formatAsOf(meta.as_of)} | Cache Age:{' '}
          {describeCacheAge(meta.cache_age_sec)}
        </p>
      ) : null}
      {error ? <p className="warn-text">{error}</p> : null}
      <div className="mover-list">
        {rows.map((row) => (
          <button
            key={`${assetType}-${row.symbol}`}
            className="mover-item"
            type="button"
            onClick={() => onSelect(row.symbol, assetType)}
          >
            <span>
              <strong>{row.symbol}</strong>
              <small>{displayLocaleNumber(row.latest)}</small>
            </span>
            <span>{displayPercent(row.change_pct, 2)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
