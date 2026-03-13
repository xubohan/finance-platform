import type { BacktestRunData, BacktestRunMeta } from '../../api/backtest'
import { displayFixed, displayPercent, displayText } from '../../utils/display'
import { formatAsOf } from '../../utils/time'
import EquityCurve from '../backtest/EquityCurve'
import DatePresetBar from './DatePresetBar'

type StrategyName = 'ma_cross' | 'macd_signal' | 'rsi_reversal'

type Props = {
  selectedSymbol: string
  selectedAssetType: string
  strategyName: StrategyName
  fast: number
  slow: number
  rsiPeriod: number
  oversold: number
  overbought: number
  initialCapital: number
  backtestStartDate: string
  backtestEndDate: string
  syncIfMissing: boolean
  loadingBacktest: boolean
  backtestError: string | null
  backtestResult: BacktestRunData | null
  backtestMeta: BacktestRunMeta | null
  trades: BacktestRunData['trades']
  onStrategyChange: (strategy: StrategyName) => void
  onFastChange: (value: number) => void
  onSlowChange: (value: number) => void
  onRsiPeriodChange: (value: number) => void
  onOversoldChange: (value: number) => void
  onOverboughtChange: (value: number) => void
  onInitialCapitalChange: (value: number) => void
  onBacktestStartDateChange: (value: string) => void
  onBacktestEndDateChange: (value: string) => void
  onSyncIfMissingChange: (value: boolean) => void
  onRunBacktest: () => void
  onPresetSelect: (preset: string) => void
  onExportBacktestJson: () => void
  onExportEquityCurve: () => void
  onExportTrades: () => void
}

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
  loadingBacktest,
  backtestError,
  backtestResult,
  backtestMeta,
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
  onRunBacktest,
  onPresetSelect,
  onExportBacktestJson,
  onExportEquityCurve,
  onExportTrades,
}: Props) {
  return (
    <section className="workspace-panel">
      <div className="panel-head">
        <h3>单标的回测</h3>
        <span>工作台默认围绕当前标的运行，不再把全市场扫描作为主入口</span>
      </div>

      <div className="backtest-form">
        <select
          className="text-input"
          value={strategyName}
          onChange={(event) => onStrategyChange(event.target.value as StrategyName)}
        >
          <option value="ma_cross">MA Cross</option>
          <option value="macd_signal">MACD Signal</option>
          <option value="rsi_reversal">RSI Reversal</option>
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
        <span>回测时允许自动补齐缺失历史</span>
      </label>

      {strategyName === 'ma_cross' ? (
        <div className="backtest-form">
          <input className="text-input" type="number" value={fast} onChange={(event) => onFastChange(Number(event.target.value))} placeholder="Fast MA" />
          <input className="text-input" type="number" value={slow} onChange={(event) => onSlowChange(Number(event.target.value))} placeholder="Slow MA" />
        </div>
      ) : null}

      {strategyName === 'rsi_reversal' ? (
        <div className="backtest-form">
          <input
            className="text-input"
            type="number"
            value={rsiPeriod}
            onChange={(event) => onRsiPeriodChange(Number(event.target.value))}
            placeholder="RSI Period"
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

      <p className="panel-copy">
        目标标的: {selectedSymbol} | 类型: {selectedAssetType.toUpperCase()} | 数据状态:{' '}
        {displayText(backtestMeta?.storage_source ?? backtestMeta?.ohlcv_source ?? backtestMeta?.source)}
      </p>
      <p className="panel-copy">
        自动补数: {syncIfMissing ? '开启' : '关闭'} | 最近同步: {formatAsOf(backtestMeta?.as_of)}
      </p>
      {!syncIfMissing && backtestMeta?.coverage_complete === false ? (
        <p className="warn-text">当前本地历史不完整，需先落地本地历史，或重新开启自动补数。</p>
      ) : null}
      {backtestError ? <p className="warn-text">{backtestError}</p> : null}
      <div className="form-row">
        <button className="secondary-btn" type="button" onClick={onExportBacktestJson} disabled={!backtestResult}>
          导出当前回测 JSON
        </button>
        <button className="secondary-btn" type="button" onClick={onExportEquityCurve} disabled={!backtestResult?.equity_curve?.length}>
          导出权益曲线 CSV
        </button>
        <button className="secondary-btn" type="button" onClick={onExportTrades} disabled={!backtestResult?.trades?.length}>
          导出成交 CSV
        </button>
        <button className="primary-btn" type="button" onClick={onRunBacktest} disabled={loadingBacktest}>
          {loadingBacktest ? '回测中...' : '运行当前回测'}
        </button>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <small>Total Return</small>
          <strong>{displayPercent(backtestResult?.metrics?.total_return, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>Annual Return</small>
          <strong>{displayPercent(backtestResult?.metrics?.annual_return, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>Sharpe</small>
          <strong>{displayFixed(backtestResult?.metrics?.sharpe_ratio, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>Max Drawdown</small>
          <strong>{displayPercent(backtestResult?.metrics?.max_drawdown, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>Win Rate</small>
          <strong>{displayPercent(backtestResult?.metrics?.win_rate, 2)}</strong>
        </div>
        <div className="metric-card">
          <small>Trades</small>
          <strong>{displayFixed(backtestResult?.metrics?.trade_count, 0)}</strong>
        </div>
      </div>

      <div className="curve-wrap">
        {backtestResult?.equity_curve?.length ? (
          <EquityCurve points={backtestResult.equity_curve} height={320} />
        ) : (
          <div className="empty-state">
            <strong>还没有回测结果</strong>
            <p>确认标的、区间和策略参数后，直接在当前页面运行单标的回测。</p>
          </div>
        )}
      </div>

      <div className="trade-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Action</th>
              <th>Price</th>
              <th>Shares</th>
              <th>PnL</th>
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
