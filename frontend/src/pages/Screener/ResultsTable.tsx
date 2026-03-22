import type {
  ScreenerFilterField,
  ScreenerResponseMeta,
  ScreenerRow,
} from '../../api/screener'
import { displayFixed, displayLocaleNumber, displayPercent, displayText } from '../../utils/display'
import { formatAsOf } from '../../utils/time'

type DynamicColumn = {
  field: ScreenerFilterField
  label: string
}

type Props = {
  results: ScreenerRow[]
  loading: boolean
  error: string | null
  hasRun: boolean
  meta: ScreenerResponseMeta | null
  pagination: {
    currentPage: number
    totalPages: number
  }
  dynamicColumns: DynamicColumn[]
  onRowSelect: (symbol: string) => void
  onPageChange: (page: number) => void
}

function formatPrice(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  const digits = Math.abs(value) >= 1 ? 2 : 4
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function renderDynamicCell(row: ScreenerRow, column: DynamicColumn) {
  if (column.field === 'pe_ttm') return displayFixed(row.pe_ttm, 2)
  if (column.field === 'roe') return displayPercent(row.roe, 2)
  if (column.field === 'profit_yoy') return displayPercent(row.profit_yoy, 2)
  return '-'
}

function getChangeClassName(changePct: number | null | undefined) {
  if (typeof changePct !== 'number' || !Number.isFinite(changePct)) return ''
  if (changePct > 0) return 'ok-text'
  if (changePct < 0) return 'warn-text'
  return ''
}

export default function ResultsTable({
  results,
  loading,
  error,
  hasRun,
  meta,
  pagination,
  dynamicColumns,
  onRowSelect,
  onPageChange,
}: Props) {
  const totalColumns = 5 + dynamicColumns.length
  const currentPage = pagination.currentPage
  const totalPages = pagination.totalPages

  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <div>
          <h3>Screening Results</h3>
          <span>点击任意结果行会直接跳转到主 Market Workspace。</span>
        </div>
        <div className="screener-results-meta">
          <span className="asset-chip">结果 {displayLocaleNumber(meta?.total_items ?? results.length)}</span>
          <span className="asset-chip asset-chip-quiet">来源 {displayText(meta?.source)}</span>
          <span className="asset-chip asset-chip-quiet">更新时间 {formatAsOf(meta?.as_of)}</span>
        </div>
      </div>
      {meta ? (
        <div className="history-strip screener-history-strip">
          <span>页面 {displayLocaleNumber(meta.page ?? currentPage)} / {displayLocaleNumber(meta.total_pages ?? totalPages)}</span>
          <span>已抓取符号 {displayLocaleNumber(meta.symbols_fetched)}</span>
          <span>已写入 fundamentals {displayLocaleNumber(meta.fundamentals_upserted)}</span>
          <span>Universe 总量 {displayLocaleNumber(meta.total_available)}</span>
          <span>Stale {meta.stale ? 'Yes' : 'No'}</span>
        </div>
      ) : null}
      {error ? <p className="warn-text">{error}</p> : null}
      {loading && results.length === 0 ? (
        <div className="empty-state">
          <div>
            <strong>正在运行筛选</strong>
            <p>后台正在拉取最新快照并整理结果。</p>
          </div>
        </div>
      ) : !hasRun ? (
        <div className="empty-state">
          <div>
            <strong>还没有结果</strong>
            <p>先设置市场与筛选条件，再点击 Apply Filters。</p>
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <div>
            <strong>本页没有命中结果</strong>
            <p>可以放宽筛选条件，或切换市场后重新 Apply。</p>
          </div>
        </div>
      ) : (
        <div className="trade-table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Price</th>
                <th>Change %</th>
                <th>Volume</th>
                {dynamicColumns.map((column) => (
                  <th key={column.field}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr
                  key={`${row.symbol}-${row.market ?? 'NA'}`}
                  className="screener-row"
                  tabIndex={0}
                  onClick={() => onRowSelect(row.symbol)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onRowSelect(row.symbol)
                    }
                  }}
                >
                  <td>
                    <button
                      className="screener-row-link"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onRowSelect(row.symbol)
                      }}
                    >
                      {row.symbol}
                    </button>
                  </td>
                  <td>{displayText(row.name)}</td>
                  <td>{formatPrice(row.last_price)}</td>
                  <td className={getChangeClassName(row.change_pct)}>{displayPercent(row.change_pct, 2)}</td>
                  <td>{displayLocaleNumber(row.volume)}</td>
                  {dynamicColumns.map((column) => (
                    <td key={`${row.symbol}-${column.field}`}>{renderDynamicCell(row, column)}</td>
                  ))}
                </tr>
              ))}
              {loading ? (
                <tr>
                  <td className="table-empty" colSpan={totalColumns}>
                    正在刷新当前结果...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {hasRun ? (
        <div className="pagination-row screener-pagination-row">
          <p className="pagination-meta">
            当前第 {displayLocaleNumber(currentPage)} 页，共 {displayLocaleNumber(totalPages)} 页。
          </p>
          <div className="screener-pagination-actions">
            <button
              className="secondary-btn"
              type="button"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={loading || currentPage <= 1}
            >
              Previous
            </button>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={loading || currentPage >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
