import { DEFAULT_COMPARE_STRATEGIES, type BacktestStrategyName } from './backtestStrategies'

export type CompareStrategyTemplate = {
  value: 'current_only' | 'core' | 'trend' | 'reversal' | 'breakout'
  label: string
  strategies: BacktestStrategyName[]
}

export const COMPARE_STRATEGY_TEMPLATES: CompareStrategyTemplate[] = [
  { value: 'current_only', label: '仅当前', strategies: [] },
  { value: 'core', label: '核心池', strategies: [...DEFAULT_COMPARE_STRATEGIES] },
  {
    value: 'trend',
    label: '趋势池',
    strategies: ['ema_cross', 'macd_signal', 'adx_trend', 'vortex_trend', 'pmo_trend'],
  },
  {
    value: 'reversal',
    label: '反转池',
    strategies: ['rsi_reversal', 'stochastic_reversal', 'bollinger_reversion', 'mfi_reversal', 'williams_reversal'],
  },
  {
    value: 'breakout',
    label: '突破池',
    strategies: ['donchian_breakout', 'atr_breakout', 'roc_breakout', 'dmi_breakout', 'supertrend_follow'],
  },
]
