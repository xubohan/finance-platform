import { useEffect, useState } from 'react'

import {
  getBacktestStrategies,
  type BacktestCompareRow,
  type BacktestRunData,
  type BacktestRunMeta,
  type BacktestStrategyCatalogEntry,
} from '../../api/backtest'
import {
  BACKTEST_STRATEGIES,
  getFastLabel,
  getOscillatorPeriodLabel,
  getSlowLabel,
  getThresholdLabels,
  isFastSlowStrategy,
  isOscillatorStrategy,
  isPeriodMultiplierStrategy,
  isThresholdStrategy,
  type BacktestStrategyName,
} from '../../utils/backtestStrategies'
import { displayFixed, displayPercent, displayText } from '../../utils/display'
import { formatAsOf } from '../../utils/time'
import EquityCurve from '../backtest/EquityCurve'
import DatePresetBar from './DatePresetBar'

type Props = {
  selectedSymbol: string
  selectedAssetType: string
  strategyName: BacktestStrategyName
  fast: number
  slow: number
  rsiPeriod: number
  oversold: number
  overbought: number
  initialCapital: number
  backtestStartDate: string
  backtestEndDate: string
  syncIfMissing: boolean
  backtestTradesPage: number
  backtestTradesTotal: number
  backtestTradesPageCount: number
  loadingBacktest: boolean
  loadingCompare: boolean
  backtestError: string | null
  compareError: string | null
  isBacktestStale: boolean
  isCompareStale: boolean
  backtestResult: BacktestRunData | null
  backtestMeta: BacktestRunMeta | null
  compareRows: BacktestCompareRow[]
  trades: BacktestRunData['trades']
  onStrategyChange: (strategy: BacktestStrategyName) => void
  onFastChange: (value: number) => void
  onSlowChange: (value: number) => void
  onRsiPeriodChange: (value: number) => void
  onOversoldChange: (value: number) => void
  onOverboughtChange: (value: number) => void
  onInitialCapitalChange: (value: number) => void
  onBacktestStartDateChange: (value: string) => void
  onBacktestEndDateChange: (value: string) => void
  onSyncIfMissingChange: (value: boolean) => void
  onBacktestTradesPageChange: (page: number) => void
  onRunBacktest: () => void
  onRunCompare: () => void
  onPresetSelect: (preset: string) => void
  onExportBacktestJson: () => void
  onExportCompareCsv: () => void
  onExportEquityCurve: () => void
  onExportTrades: () => void
}

function fallbackStrategyMode(name: BacktestStrategyName): BacktestStrategyCatalogEntry['parameter_mode'] {
  if (isFastSlowStrategy(name)) return 'fast_slow'
  if (isOscillatorStrategy(name)) return 'oscillator'
  if (isThresholdStrategy(name)) return 'threshold'
  if (isPeriodMultiplierStrategy(name)) return 'period_multiplier'
  if (name === 'buy_hold') return 'none'
  return 'special'
}

const FALLBACK_STRATEGY_CATALOG: BacktestStrategyCatalogEntry[] = BACKTEST_STRATEGIES.map((strategy) => ({
  name: strategy.value,
  label: strategy.label,
  parameter_mode: fallbackStrategyMode(strategy.value),
  summary: '',
}))

export default function BacktestPanel({
  selectedSymbol,
  selectedAssetType,
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
  backtestTradesPage,
  backtestTradesTotal,
  backtestTradesPageCount,
  loadingBacktest,
  loadingCompare,
  backtestError,
  compareError,
  isBacktestStale,
  isCompareStale,
  backtestResult,
  backtestMeta,
  compareRows,
  trades,
  onStrategyChange,
  onFastChange,
  onSlowChange,
  onRsiPeriodChange,
  onOversoldChange,
  onOverboughtChange,
  onInitialCapitalChange,
  onBacktestStartDateChange,
  onBacktestEndDateChange,
  onSyncIfMissingChange,
  onBacktestTradesPageChange,
  onRunBacktest,
  onRunCompare,
  onPresetSelect,
  onExportBacktestJson,
  onExportCompareCsv,
  onExportEquityCurve,
  onExportTrades,
}: Props) {
  const [strategyCatalog, setStrategyCatalog] = useState<BacktestStrategyCatalogEntry[]>(FALLBACK_STRATEGY_CATALOG)
  const [strategyCatalogError, setStrategyCatalogError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void getBacktestStrategies()
      .then((resp) => {
        if (cancelled) return
        if (resp.data.length > 0) {
          setStrategyCatalog(resp.data)
          setStrategyCatalogError(null)
        }
      })
      .catch(() => {
        if (cancelled) return
        setStrategyCatalog(FALLBACK_STRATEGY_CATALOG)
        setStrategyCatalogError('策略目录同步失败，已回退本地目录。')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const selectedStrategyMeta = strategyCatalog.find((item) => item.name === strategyName)
  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <h3>单标的回测</h3>
        <span>只围绕当前标的运行</span>
      </div>

      <div className="backtest-form">
        <select
          className="text-input"
          value={strategyName}
          onChange={(event) => onStrategyChange(event.target.value as BacktestStrategyName)}
        >
          {strategyCatalog.map((strategy) => (
            <option key={strategy.name} value={strategy.name}>
              {strategy.label}
            </option>
          ))}
        </select>
        <input className="text-input" type="date" value={backtestStartDate} onChange={(event) => onBacktestStartDateChange(event.target.value)} />
        <input className="text-input" type="date" value={backtestEndDate} onChange={(event) => onBacktestEndDateChange(event.target.value)} />
        <input
          className="text-input"
          type="number"
          min={1000}
          step={1000}
          value={initialCapital}
          onChange={(event) => onInitialCapitalChange(Number(event.target.value))}
          placeholder="初始资金"
        />
      </div>
      <DatePresetBar
        presets={[
          { label: '6M', value: '6m' },
          { label: '1Y', value: '1y' },
          { label: '3Y', value: '3y' },
          { label: '5Y', value: '5y' },
        ]}
        onSelect={onPresetSelect}
      />
      <label className="toggle-row">
        <input type="checkbox" checked={syncIfMissing} onChange={(event) => onSyncIfMissingChange(event.target.checked)} />
        <span>回测时自动补齐缺失历史</span>
      </label>
      {strategyCatalogError ? <p className="panel-copy">{strategyCatalogError}</p> : null}
      {selectedStrategyMeta?.summary ? <p className="panel-copy">说明: {selectedStrategyMeta.summary}</p> : null}

      {isFastSlowStrategy(strategyName) ? (
        <div className="backtest-form">
          <input
            className="text-input"
            type="number"
            value={fast}
            onChange={(event) => onFastChange(Number(event.target.value))}
            placeholder={getFastLabel(strategyName)}
          />
          <input
            className="text-input"
            type="number"
            value={slow}
            onChange={(event) => onSlowChange(Number(event.target.value))}
            placeholder={getSlowLabel(strategyName)}
          />
        </div>
      ) : null}

      {isOscillatorStrategy(strategyName) ? (
        <div className="backtest-form">
          <input
            className="text-input"
            type="number"
            value={rsiPeriod}
            onChange={(event) => onRsiPeriodChange(Number(event.target.value))}
            placeholder={getOscillatorPeriodLabel(strategyName)}
          />
          <input
            className="text-input"
            type="number"
            value={oversold}
            onChange={(event) => onOversoldChange(Number(event.target.value))}
            placeholder="Oversold"
          />
          <input
            className="text-input"
            type="number"
            value={overbought}
            onChange={(event) => onOverboughtChange(Number(event.target.value))}
            placeholder="Overbought"
          />
        </div>
      ) : null}

      {strategyName === 'cci_reversal' ? (
        <div className="backtest-form">
          <input
            className="text-input"
            type="number"
            value={rsiPeriod}
            onChange={(event) => onRsiPeriodChange(Number(event.target.value))}
            placeholder="CCI Period"
          />
          <input
            className="text-input"
            type="number"
            value={oversold}
            onChange={(event) => onOversoldChange(Number(event.target.value))}
            placeholder="Oversold"
          />
          <input
            className="text-input"
            type="number"
            value={overbought}
            onChange={(event) => onOverboughtChange(Number(event.target.value))}
            placeholder="Overbought"
          />
        </div>
      ) : null}

      {strategyName === 'bollinger_reversion' ? (
        <div className="backtest-form">
          <input
            className="text-input"
            type="number"
            min={5}
            value={rsiPeriod}
            onChange={(event) => onRsiPeriodChange(Number(event.target.value))}
            placeholder="Band Period"
          />
          <input
            className="text-input"
            type="number"
            min={1}
            step={0.1}
            value={oversold}
            onChange={(event) => onOversoldChange(Number(event.target.value))}
            placeholder="Std Dev"
          />
        </div>
      ) : null}

      {isPeriodMultiplierStrategy(strategyName) ? (
        <div className="backtest-form">
          <input
            className="text-input"
            type="number"
            min={5}
            value={rsiPeriod}
            onChange={(event) => onRsiPeriodChange(Number(event.target.value))}
            placeholder={strategyName === 'supertrend_follow' ? 'ATR Period' : 'Channel Period'}
          />
          <input
            className="text-input"
            type="number"
            min={1}
            step={0.1}
            value={oversold}
            onChange={(event) => onOversoldChange(Number(event.target.value))}
            placeholder="Multiplier"
          />
        </div>
      ) : null}

      {strategyName === 'vwap_reversion' || strategyName === 'atr_breakout' ? (
        <div className="backtest-form">
          <input
            className="text-input"
            type="number"
            min={5}
            value={rsiPeriod}
            onChange={(event) => onRsiPeriodChange(Number(event.target.value))}
            placeholder={strategyName === 'vwap_reversion' ? 'VWAP Period' : 'ATR Period'}
          />
          <input
            className="text-input"
            type="number"
            min={0.1}
            step={0.1}
            value={oversold}
            onChange={(event) => onOversoldChange(Number(event.target.value))}
            placeholder={strategyName === 'vwap_reversion' ? 'Deviation %' : 'Multiplier'}
          />
        </div>
      ) : null}

      {strategyName === 'donchian_breakout' ? (
        <div className="backtest-form">
          <input
            className="text-input"
            type="number"
            min={5}
            value={fast}
            onChange={(event) => onFastChange(Number(event.target.value))}
            placeholder="Breakout Lookback"
          />
          <input
            className="text-input"
            type="number"
            min={2}
            value={slow}
            onChange={(event) => onSlowChange(Number(event.target.value))}
            placeholder="Exit Lookback"
          />
        </div>
      ) : null}

      {isThresholdStrategy(strategyName) ? (
        <div className="backtest-form">
          <input
            className="text-input"
            type="number"
            min={5}
            value={rsiPeriod}
            onChange={(event) => onRsiPeriodChange(Number(event.target.value))}
            placeholder={getThresholdLabels(strategyName).period}
          />
          <input
            className="text-input"
            type="number"
            min={1}
            step={0.1}
            value={oversold}
            onChange={(event) => onOversoldChange(Number(event.target.value))}
            placeholder={getThresholdLabels(strategyName).threshold}
          />
        </div>
      ) : null}

      <p className="panel-copy">
        标的: {selectedSymbol} | 类型: {selectedAssetType.toUpperCase()} | 数据源:{' '}
        {displayText(backtestMeta?.storage_source ?? backtestMeta?.ohlcv_source ?? backtestMeta?.source)}
      </p>
      <p className="panel-copy">
        自动补数: {syncIfMissing ? '开启' : '关闭'} | 同步时间: {formatAsOf(backtestMeta?.as_of)}
      </p>
      {!syncIfMissing && backtestMeta?.coverage_complete === false ? (
        <p className="warn-text">本地历史不完整，请先同步或开启自动补数。</p>
      ) : null}
      {backtestError ? <p className="warn-text">{backtestError}</p> : null}
      {compareError ? <p className="warn-text">{compareError}</p> : null}
      <div className="form-row">
        <button className="secondary-btn" type="button" onClick={onExportBacktestJson} disabled={!backtestResult || isBacktestStale}>
          导出回测JSON
        </button>
        <button className="secondary-btn" type="button" onClick={onExportCompareCsv} disabled={compareRows.length === 0 || isCompareStale}>
          对比CSV
        </button>
        <button className="secondary-btn" type="button" onClick={onExportEquityCurve} disabled={!backtestResult?.equity_curve?.length || isBacktestStale}>
          导出权益CSV
        </button>
        <button className="secondary-btn" type="button" onClick={onExportTrades} disabled={!backtestResult?.trades?.length || isBacktestStale}>
          导出成交CSV
        </button>
        <button className="primary-btn" type="button" onClick={onRunBacktest} disabled={loadingBacktest}>
          {loadingBacktest ? '回测中...' : '运行当前回测'}
        </button>
        <button className="secondary-btn" type="button" onClick={onRunCompare} disabled={loadingCompare}>
          {loadingCompare ? '对比中...' : '对比'}
        </button>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <small>总收益</small>
          <strong>{displayPercent(backtestResult?.metrics?.total_return, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>年化收益</small>
          <strong>{displayPercent(backtestResult?.metrics?.annual_return, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>夏普</small>
          <strong>{displayFixed(backtestResult?.metrics?.sharpe_ratio, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>回撤</small>
          <strong>{displayPercent(backtestResult?.metrics?.max_drawdown, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>胜率</small>
          <strong>{displayPercent(backtestResult?.metrics?.win_rate, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>成交</small>
          <strong>{displayFixed(backtestResult?.metrics?.trade_count, 0)}</strong>
        </div>
      </div>

      {compareRows.length > 0 ? (
        <div className="trade-table-wrap">
          <p className="panel-copy">对比表</p>
          <table className="table">
            <thead>
              <tr>
                <th>策略</th>
                <th>总收益</th>
                <th>夏普</th>
                <th>回撤</th>
                <th>成交</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row) => (
                <tr key={row.strategy_name}>
                  <td>{displayText(row.label)}</td>
                  <td>{displayPercent(row.total_return, 2)}</td>
                  <td>{displayFixed(row.sharpe_ratio, 2)}</td>
                  <td>{displayPercent(row.max_drawdown, 2)}</td>
                  <td>{displayFixed(row.trade_count, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="curve-wrap">
        {backtestResult?.equity_curve?.length ? (
          <EquityCurve points={backtestResult.equity_curve} height={320} />
        ) : (
          <div className="empty-state">
            <strong>暂无回测结果</strong>
            <p>确认区间和参数后，直接运行回测。</p>
          </div>
        )}
      </div>

      <div className="trade-table-wrap">
        {backtestTradesTotal > 0 ? (
          <div className="pagination-row">
            <p className="panel-copy pagination-meta">
              成交记录第 {backtestTradesPage} / {backtestTradesPageCount} 页，共 {backtestTradesTotal} 笔
            </p>
            {backtestTradesPageCount > 1 ? (
              <div className="form-row">
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => onBacktestTradesPageChange(backtestTradesPage - 1)}
                  disabled={backtestTradesPage <= 1}
                >
                  上一页成交记录
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => onBacktestTradesPageChange(backtestTradesPage + 1)}
                  disabled={backtestTradesPage >= backtestTradesPageCount}
                >
                  下一页成交记录
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        <table className="table">
          <thead>
            <tr>
              <th>日期</th>
              <th>动作</th>
              <th>价格</th>
              <th>数量</th>
              <th>盈亏</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={5}>
                  暂无成交记录
                </td>
              </tr>
            ) : null}
            {trades.map((trade, index) => (
              <tr key={`${trade.date}-${trade.action}-${index}`}>
                <td>{displayText(trade.date)}</td>
                <td>{displayText(trade.action)}</td>
                <td>{displayFixed(trade.price, 2)}</td>
                <td>{displayFixed(trade.shares, 4)}</td>
                <td>{displayFixed(trade.pnl, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
