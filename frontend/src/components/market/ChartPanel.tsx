import type { CandlestickData } from 'lightweight-charts'

import type { MarketPeriod, SearchAsset } from '../../api/market'
import { displayLocaleNumber } from '../../utils/display'
import { formatAsOf } from '../../utils/time'
import IndicatorPanel from '../chart/IndicatorPanel'
import KlineChart from '../chart/KlineChart'
import DatePresetBar from './DatePresetBar'

type Props = {
  selectedAsset: SearchAsset
  period: MarketPeriod
  chartStartDate: string
  chartEndDate: string
  marketMeta: {
    kline?: { as_of?: string | null }
  }
  quoteAsOf?: string | null
  historyStatus: {
    local_start?: string | null
    local_end?: string | null
    local_rows: number
  } | null
  chartStateText: string | null
  selectedIndicators: string[]
  candles: CandlestickData[]
  onPeriodChange: (period: MarketPeriod) => void
  onChartStartDateChange: (value: string) => void
  onChartEndDateChange: (value: string) => void
  onSelectPreset: (preset: string) => void
  onToggleIndicator: (name: string) => void
}

export default function ChartPanel({
  selectedAsset,
  period,
  chartStartDate,
  chartEndDate,
  marketMeta,
  quoteAsOf,
  historyStatus,
  chartStateText,
  selectedIndicators,
  candles,
  onPeriodChange,
  onChartStartDateChange,
  onChartEndDateChange,
  onSelectPreset,
  onToggleIndicator,
}: Props) {
  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <h3>实时行情与 K 线</h3>
        <span>切换区间时会直接请求实时接口，并把最新历史落到本地数据层</span>
      </div>
      <div className="form-row toolbar-row chart-toolbar-row">
        <select className="text-input" value={period} onChange={(event) => onPeriodChange(event.target.value as MarketPeriod)}>
          <option value="1d">1D</option>
          <option value="1W">1W</option>
          <option value="1M">1M</option>
        </select>
        <input className="text-input" type="date" value={chartStartDate} onChange={(event) => onChartStartDateChange(event.target.value)} />
        <input className="text-input" type="date" value={chartEndDate} onChange={(event) => onChartEndDateChange(event.target.value)} />
      </div>
      <DatePresetBar
        presets={[
          { label: '1M', value: '1m' },
          { label: '3M', value: '3m' },
          { label: '6M', value: '6m' },
          { label: '1Y', value: '1y' },
          { label: '3Y', value: '3y' },
          { label: 'YTD', value: 'ytd' },
        ]}
        onSelect={onSelectPreset}
      />
      <p className="panel-copy">
        当前标的 {selectedAsset.symbol} | 报价时间: {formatAsOf(quoteAsOf)} | K 线时间: {formatAsOf(marketMeta.kline?.as_of)}
      </p>
      <div className="history-strip">
        <span>本地开始: {formatAsOf(historyStatus?.local_start)}</span>
        <span>本地结束: {formatAsOf(historyStatus?.local_end)}</span>
        <span>本地行数: {displayLocaleNumber(historyStatus?.local_rows)}</span>
      </div>
      {chartStateText ? <p className="panel-copy">{chartStateText}</p> : null}
      <IndicatorPanel selected={selectedIndicators} onToggle={onToggleIndicator} />
      <div className="chart-frame">
        <KlineChart candles={candles} showMA={selectedIndicators.includes('MA')} showRSI={selectedIndicators.includes('RSI')} height={460} />
      </div>
    </section>
  )
}
