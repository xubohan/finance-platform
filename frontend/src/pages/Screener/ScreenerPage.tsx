import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { extractApiError } from '../../api/client'
import {
  getSymbols,
  runScreener,
  type ScreenerFilter,
  type ScreenerFilterField,
  type ScreenerFilterOperator,
  type ScreenerMarketType,
  type ScreenerResponseMeta,
  type ScreenerRow,
  type ScreenerSymbol,
} from '../../api/screener'
import FilterPanel from './FilterPanel'
import ResultsTable from './ResultsTable'

type ActiveScreenerRequest = {
  marketType: ScreenerMarketType
  filters: ScreenerFilter[]
}

const MARKET_OPTIONS: Array<{
  value: ScreenerMarketType
  label: string
  hint: string
}> = [
  { value: 'america', label: 'America', hint: 'US listed stocks' },
  { value: 'china', label: 'China A', hint: 'Shanghai / Shenzhen' },
]

const FILTER_OPTIONS: Array<{
  field: ScreenerFilterField
  label: string
  hint: string
  placeholder: string
  columnLabel: string
  operators: Array<{
    value: ScreenerFilterOperator
    label: string
  }>
}> = [
  {
    field: 'pe_ttm',
    label: 'PE Ratio',
    hint: '估值区间',
    placeholder: '例如 20',
    columnLabel: 'PE',
    operators: [
      { value: 'lte', label: '<=' },
      { value: 'gte', label: '>=' },
    ],
  },
  {
    field: 'roe',
    label: 'ROE',
    hint: '盈利能力',
    placeholder: '例如 12',
    columnLabel: 'ROE',
    operators: [{ value: 'gte', label: '>=' }],
  },
  {
    field: 'profit_yoy',
    label: 'Profit YoY',
    hint: '利润同比增长',
    placeholder: '例如 15',
    columnLabel: 'Profit YoY',
    operators: [{ value: 'gte', label: '>=' }],
  },
]

function createDefaultFilters(): ScreenerFilter[] {
  return [
    { field: 'pe_ttm', operator: 'lte', value: null },
    { field: 'roe', operator: 'gte', value: null },
    { field: 'profit_yoy', operator: 'gte', value: null },
  ]
}

function cloneFilters(filters: ScreenerFilter[]) {
  return filters.map((filter) => ({ ...filter }))
}

function normalizeFilters(filters: ScreenerFilter[]) {
  return filters
    .map((filter) => ({
      ...filter,
      value: typeof filter.value === 'number' && Number.isFinite(filter.value) ? filter.value : null,
    }))
    .filter((filter) => filter.value !== null)
}

export default function ScreenerPage() {
  const navigate = useNavigate()
  const activeRequestRef = useRef<ActiveScreenerRequest | null>(null)

  const [filters, setFilters] = useState<ScreenerFilter[]>(() => createDefaultFilters())
  const [appliedFilters, setAppliedFilters] = useState<ScreenerFilter[]>([])
  const [marketType, setMarketType] = useState<ScreenerMarketType>('america')
  const [results, setResults] = useState<ScreenerRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasRun, setHasRun] = useState(false)
  const [pagination, setPagination] = useState({ currentPage: 1, totalPages: 1 })
  const [meta, setMeta] = useState<ScreenerResponseMeta | null>(null)

  const [quickOpenSymbol, setQuickOpenSymbol] = useState('')
  const [symbolOptions, setSymbolOptions] = useState<ScreenerSymbol[]>([])
  const [symbolLoading, setSymbolLoading] = useState(false)
  const [symbolError, setSymbolError] = useState<string | null>(null)

  const activeFilterCount = useMemo(() => normalizeFilters(filters).length, [filters])
  const dynamicColumns = useMemo(() => {
    const selectedFields = new Set((hasRun ? appliedFilters : normalizeFilters(filters)).map((filter) => filter.field))
    return FILTER_OPTIONS.filter((item) => selectedFields.has(item.field)).map((item) => ({
      field: item.field,
      label: item.columnLabel,
    }))
  }, [appliedFilters, filters, hasRun])

  const loadSymbols = useCallback(async () => {
    setSymbolLoading(true)
    setSymbolError(null)
    try {
      const resp = await getSymbols({
        market: marketType,
        limit: 80,
        force_refresh: false,
        allow_stale: true,
      })
      setSymbolOptions(resp.data)
    } catch (requestError) {
      setSymbolOptions([])
      setSymbolError(extractApiError(requestError, '加载标的建议失败'))
    } finally {
      setSymbolLoading(false)
    }
  }, [marketType])

  useEffect(() => {
    void loadSymbols()
  }, [loadSymbols])

  const loadResults = useCallback(
    async (params: {
      page: number
      forceRefresh: boolean
      allowStale: boolean
      requestSnapshot?: ActiveScreenerRequest
    }) => {
      const requestSnapshot = params.requestSnapshot ?? activeRequestRef.current ?? {
        marketType,
        filters: cloneFilters(normalizeFilters(filters)),
      }
      const frozenSnapshot = {
        marketType: requestSnapshot.marketType,
        filters: cloneFilters(requestSnapshot.filters),
      }

      activeRequestRef.current = frozenSnapshot
      setAppliedFilters(cloneFilters(frozenSnapshot.filters))
      setIsLoading(true)
      setError(null)
      setHasRun(true)
      try {
        const resp = await runScreener({
          market: frozenSnapshot.marketType,
          filters: frozenSnapshot.filters,
          page: params.page,
          force_refresh: params.forceRefresh,
          allow_stale: params.allowStale,
        })

        setResults(resp.data)
        setMeta(resp.meta ?? null)
        setPagination({
          currentPage: resp.meta?.page ?? params.page,
          totalPages: resp.meta?.total_pages ?? 1,
        })
      } catch (requestError) {
        setResults([])
        setMeta(null)
        setPagination({ currentPage: 1, totalPages: 1 })
        setError(extractApiError(requestError, '运行筛选失败'))
      } finally {
        setIsLoading(false)
      }
    },
    [filters, marketType],
  )

  const handleApplyFilters = useCallback(() => {
    const snapshot = {
      marketType,
      filters: cloneFilters(normalizeFilters(filters)),
    }
    void loadResults({
      page: 1,
      forceRefresh: true,
      allowStale: false,
      requestSnapshot: snapshot,
    })
  }, [filters, loadResults, marketType])

  const handleRefresh = useCallback(() => {
    const snapshot = activeRequestRef.current ?? {
      marketType,
      filters: cloneFilters(normalizeFilters(filters)),
    }
    void loadResults({
      page: pagination.currentPage,
      forceRefresh: true,
      allowStale: false,
      requestSnapshot: snapshot,
    })
  }, [filters, loadResults, marketType, pagination.currentPage])

  const handlePageChange = useCallback(
    (page: number) => {
      if (page < 1 || page > pagination.totalPages || !activeRequestRef.current) return
      void loadResults({
        page,
        forceRefresh: false,
        allowStale: true,
        requestSnapshot: activeRequestRef.current,
      })
    },
    [loadResults, pagination.totalPages],
  )

  const handleClearFilters = useCallback(() => {
    setFilters(createDefaultFilters())
    setAppliedFilters([])
    setResults([])
    setMeta(null)
    setError(null)
    setHasRun(false)
    setPagination({ currentPage: 1, totalPages: 1 })
    activeRequestRef.current = null
  }, [])

  const handleFilterOperatorChange = useCallback((field: ScreenerFilterField, operator: ScreenerFilterOperator) => {
    setFilters((previous) =>
      previous.map((filter) => (filter.field === field ? { ...filter, operator } : filter)),
    )
  }, [])

  const handleFilterValueChange = useCallback((field: ScreenerFilterField, rawValue: string) => {
    const nextValue = rawValue.trim() === '' ? null : Number(rawValue)
    setFilters((previous) =>
      previous.map((filter) => {
        if (filter.field !== field) return filter
        return {
          ...filter,
          value: typeof nextValue === 'number' && Number.isFinite(nextValue) ? nextValue : null,
        }
      }),
    )
  }, [])

  const handleQuickOpen = useCallback(() => {
    const symbol = quickOpenSymbol.trim().toUpperCase()
    if (!symbol) return
    navigate(`/market?symbol=${encodeURIComponent(symbol)}`)
  }, [navigate, quickOpenSymbol])

  const handleRowSelect = useCallback(
    (symbol: string) => {
      navigate(`/market?symbol=${encodeURIComponent(symbol)}`)
    },
    [navigate],
  )

  return (
    <section className="market-page screener-page">
      <section className="workspace-hero screener-hero">
        <div>
          <p className="eyebrow">Market Discovery</p>
          <h2>Market Workspace Screener</h2>
          <p className="shell-copy screener-hero-copy">
            用显式 Apply / Pagination / Refresh 三个动作控制实时快照请求，避免输入阶段就把 DB 刷爆。
          </p>
        </div>
        <div className="screener-hero-side">
          <div className="screener-market-switch" role="tablist" aria-label="Select screener market">
            {MARKET_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={marketType === option.value ? 'chip chip-active' : 'chip'}
                type="button"
                onClick={() => setMarketType(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="panel-copy screener-market-copy">
            {MARKET_OPTIONS.find((item) => item.value === marketType)?.hint}
          </p>
          <div className="screener-quick-open">
            <label className="screener-control-label" htmlFor="screener-quick-open">
              Universe Quick Open
            </label>
            <div className="form-row">
              <input
                id="screener-quick-open"
                className="text-input flex-input"
                list="screener-symbol-options"
                value={quickOpenSymbol}
                placeholder="输入代码后直接跳去 Market Workspace"
                onChange={(event) => setQuickOpenSymbol(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleQuickOpen()
                  }
                }}
              />
              <button
                className="secondary-btn"
                type="button"
                onClick={handleQuickOpen}
                disabled={!quickOpenSymbol.trim()}
              >
                Open Workspace
              </button>
            </div>
            <datalist id="screener-symbol-options">
              {symbolOptions.map((symbol) => (
                <option key={symbol.symbol} value={symbol.symbol}>
                  {symbol.name}
                </option>
              ))}
            </datalist>
            <p className={symbolError ? 'warn-text' : 'panel-copy'}>
              {symbolError
                ? symbolError
                : symbolLoading
                  ? '正在加载市场符号建议...'
                  : `已加载 ${symbolOptions.length} 条符号建议，当前草稿筛选 ${activeFilterCount} 条。`}
            </p>
          </div>
        </div>
      </section>

      <FilterPanel
        filterOptions={FILTER_OPTIONS}
        filters={filters}
        isLoading={isLoading}
        hasRun={hasRun}
        canRefresh={hasRun || activeFilterCount > 0}
        onFilterOperatorChange={handleFilterOperatorChange}
        onFilterValueChange={handleFilterValueChange}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        onRefresh={handleRefresh}
      />

      <ResultsTable
        results={results}
        loading={isLoading}
        error={error}
        hasRun={hasRun}
        meta={meta}
        pagination={pagination}
        dynamicColumns={dynamicColumns}
        onRowSelect={handleRowSelect}
        onPageChange={handlePageChange}
      />
    </section>
  )
}
