import type {
  ScreenerFilter,
  ScreenerFilterField,
  ScreenerFilterOperator,
} from '../../api/screener'

type FilterOption = {
  field: ScreenerFilterField
  label: string
  hint: string
  placeholder: string
  operators: Array<{
    value: ScreenerFilterOperator
    label: string
  }>
}

type Props = {
  filterOptions: FilterOption[]
  filters: ScreenerFilter[]
  isLoading: boolean
  hasRun: boolean
  canRefresh: boolean
  onFilterOperatorChange: (field: ScreenerFilterField, operator: ScreenerFilterOperator) => void
  onFilterValueChange: (field: ScreenerFilterField, value: string) => void
  onApply: () => void
  onClear: () => void
  onRefresh: () => void
}

function getFilter(filters: ScreenerFilter[], field: ScreenerFilterField) {
  return filters.find((item) => item.field === field) ?? null
}

export default function FilterPanel({
  filterOptions,
  filters,
  isLoading,
  hasRun,
  canRefresh,
  onFilterOperatorChange,
  onFilterValueChange,
  onApply,
  onClear,
  onRefresh,
}: Props) {
  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <div>
          <h3>Filter Control Panel</h3>
          <span>显式点击 Apply 后才触发筛选，避免每次输入都触发最新 fundamentals 写入。</span>
        </div>
        <div className="screener-action-bar">
          <button className="primary-btn" type="button" onClick={onApply} disabled={isLoading}>
            {isLoading ? 'Applying...' : 'Apply Filters'}
          </button>
          <button className="secondary-btn" type="button" onClick={onClear} disabled={isLoading}>
            Clear Filters
          </button>
          <button
            className="icon-btn"
            type="button"
            onClick={onRefresh}
            disabled={isLoading || !canRefresh}
            aria-label="Refresh Snapshot"
            title={hasRun ? 'Refresh current snapshot' : 'Refresh with current draft filters'}
          >
            <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>
      <p className="panel-copy">
        当前后端已稳定支持 PE / ROE / Profit YoY 这组实时筛选；其它 TradingView 条件先不在前端伪造。
      </p>
      <div className="screener-filter-grid">
        {filterOptions.map((option) => {
          const filter = getFilter(filters, option.field)
          return (
            <div key={option.field} className="screener-filter-card">
              <div className="screener-filter-head">
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </div>
              <div className="form-row screener-filter-controls">
                <select
                  className="text-input"
                  value={filter?.operator ?? option.operators[0]?.value ?? 'gte'}
                  onChange={(event) =>
                    onFilterOperatorChange(option.field, event.target.value as ScreenerFilterOperator)
                  }
                >
                  {option.operators.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>
                <input
                  className="text-input"
                  type="number"
                  inputMode="decimal"
                  value={filter?.value ?? ''}
                  placeholder={option.placeholder}
                  onChange={(event) => onFilterValueChange(option.field, event.target.value)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
