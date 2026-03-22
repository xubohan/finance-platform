export const BACKTEST_STRATEGIES = [
  { value: 'buy_hold', label: 'Buy And Hold' },
  { value: 'ma_cross', label: 'MA Cross' },
  { value: 'ema_cross', label: 'EMA Cross' },
  { value: 'alma_cross', label: 'ALMA Cross' },
  { value: 'lsma_cross', label: 'LSMA Cross' },
  { value: 'mcginley_cross', label: 'McGinley Cross' },
  { value: 't3_cross', label: 'T3 Cross' },
  { value: 'trima_cross', label: 'TRIMA Cross' },
  { value: 'smma_cross', label: 'SMMA Cross' },
  { value: 'vwma_cross', label: 'VWMA Cross' },
  { value: 'dema_cross', label: 'DEMA Cross' },
  { value: 'zlema_cross', label: 'ZLEMA Cross' },
  { value: 'tema_cross', label: 'TEMA Cross' },
  { value: 'wma_cross', label: 'WMA Cross' },
  { value: 'hma_cross', label: 'HMA Cross' },
  { value: 'macd_signal', label: 'MACD Signal' },
  { value: 'rsi_reversal', label: 'RSI Reversal' },
  { value: 'stochastic_reversal', label: 'Stochastic Reversal' },
  { value: 'bias_reversal', label: 'BIAS Reversal' },
  { value: 'demarker_reversal', label: 'DeMarker Reversal' },
  { value: 'cfo_reversal', label: 'CFO Reversal' },
  { value: 'smi_reversal', label: 'SMI Reversal' },
  { value: 'awesome_reversal', label: 'Awesome Reversal' },
  { value: 'schaff_reversal', label: 'Schaff Reversal' },
  { value: 'ultimate_oscillator_reversal', label: 'Ultimate Oscillator Reversal' },
  { value: 'stochrsi_reversal', label: 'StochRSI Reversal' },
  { value: 'rvi_reversal', label: 'RVI Reversal' },
  { value: 'mfi_reversal', label: 'MFI Reversal' },
  { value: 'cmo_reversal', label: 'CMO Reversal' },
  { value: 'dpo_reversal', label: 'DPO Reversal' },
  { value: 'williams_reversal', label: 'Williams Reversal' },
  { value: 'fisher_reversal', label: 'Fisher Reversal' },
  { value: 'bollinger_reversion', label: 'Bollinger Reversion' },
  { value: 'donchian_breakout', label: 'Donchian Breakout' },
  { value: 'supertrend_follow', label: 'Supertrend Follow' },
  { value: 'adx_trend', label: 'ADX Trend' },
  { value: 'chaikin_money_flow_trend', label: 'Chaikin Money Flow Trend' },
  { value: 'chaikin_volatility_trend', label: 'Chaikin Volatility Trend' },
  { value: 'aroon_trend', label: 'Aroon Trend' },
  { value: 'efi_trend', label: 'EFI Trend' },
  { value: 'vzo_trend', label: 'VZO Trend' },
  { value: 'vhf_trend', label: 'VHF Trend' },
  { value: 'kst_trend', label: 'KST Trend' },
  { value: 'pmo_trend', label: 'PMO Trend' },
  { value: 'roc_breakout', label: 'ROC Breakout' },
  { value: 'linreg_slope_trend', label: 'LinReg Slope Trend' },
  { value: 'trix_trend', label: 'TRIX Trend' },
  { value: 'tsi_trend', label: 'TSI Trend' },
  { value: 'coppock_trend', label: 'Coppock Trend' },
  { value: 'vortex_trend', label: 'Vortex Trend' },
  { value: 'keltner_reversion', label: 'Keltner Reversion' },
  { value: 'vwap_reversion', label: 'VWAP Reversion' },
  { value: 'atr_breakout', label: 'ATR Breakout' },
  { value: 'cci_reversal', label: 'CCI Reversal' },
  { value: 'obv_trend', label: 'OBV Trend' },
  { value: 'dmi_breakout', label: 'DMI Breakout' },
  { value: 'chaikin_reversal', label: 'Chaikin Reversal' },
] as const

export type BacktestStrategyName = (typeof BACKTEST_STRATEGIES)[number]['value']

export const BACKTEST_STRATEGY_VALUES = BACKTEST_STRATEGIES.map((item) => item.value)
export const DEFAULT_COMPARE_STRATEGIES: BacktestStrategyName[] = [
  'buy_hold',
  'ma_cross',
  'ema_cross',
  'macd_signal',
  'rsi_reversal',
]

const FAST_SLOW_STRATEGIES = new Set<BacktestStrategyName>(['ma_cross', 'ema_cross', 'alma_cross', 'lsma_cross', 'mcginley_cross', 't3_cross', 'trima_cross', 'smma_cross', 'vwma_cross', 'dema_cross', 'zlema_cross', 'tema_cross', 'wma_cross', 'hma_cross', 'obv_trend', 'chaikin_reversal'])
const OSCILLATOR_STRATEGIES = new Set<BacktestStrategyName>(['rsi_reversal', 'stochastic_reversal', 'bias_reversal', 'demarker_reversal', 'cfo_reversal', 'smi_reversal', 'awesome_reversal', 'schaff_reversal', 'ultimate_oscillator_reversal', 'stochrsi_reversal', 'rvi_reversal', 'mfi_reversal', 'cmo_reversal', 'dpo_reversal', 'williams_reversal', 'fisher_reversal'])
const THRESHOLD_STRATEGIES = new Set<BacktestStrategyName>(['adx_trend', 'dmi_breakout', 'chaikin_money_flow_trend', 'chaikin_volatility_trend', 'aroon_trend', 'efi_trend', 'vzo_trend', 'vhf_trend', 'kst_trend', 'pmo_trend', 'roc_breakout', 'linreg_slope_trend', 'trix_trend', 'tsi_trend', 'coppock_trend', 'vortex_trend'])
const PERIOD_MULTIPLIER_STRATEGIES = new Set<BacktestStrategyName>(['supertrend_follow', 'keltner_reversion'])

export function isFastSlowStrategy(name: BacktestStrategyName): boolean {
  return FAST_SLOW_STRATEGIES.has(name)
}

export function isOscillatorStrategy(name: BacktestStrategyName): boolean {
  return OSCILLATOR_STRATEGIES.has(name)
}

export function isThresholdStrategy(name: BacktestStrategyName): boolean {
  return THRESHOLD_STRATEGIES.has(name)
}

export function isPeriodMultiplierStrategy(name: BacktestStrategyName): boolean {
  return PERIOD_MULTIPLIER_STRATEGIES.has(name)
}

export function getFastLabel(name: BacktestStrategyName): string {
  if (name === 'ema_cross') return 'Fast EMA'
  if (name === 'alma_cross') return 'Fast ALMA'
  if (name === 'lsma_cross') return 'Fast LSMA'
  if (name === 'mcginley_cross') return 'Fast McGinley'
  if (name === 't3_cross') return 'Fast T3'
  if (name === 'trima_cross') return 'Fast TRIMA'
  if (name === 'smma_cross') return 'Fast SMMA'
  if (name === 'vwma_cross') return 'Fast VWMA'
  if (name === 'dema_cross') return 'Fast DEMA'
  if (name === 'zlema_cross') return 'Fast ZLEMA'
  if (name === 'tema_cross') return 'Fast TEMA'
  if (name === 'wma_cross') return 'Fast WMA'
  if (name === 'hma_cross') return 'Fast HMA'
  if (name === 'obv_trend') return 'Fast OBV'
  if (name === 'chaikin_reversal') return 'Fast Chaikin'
  return 'Fast MA'
}

export function getSlowLabel(name: BacktestStrategyName): string {
  if (name === 'ema_cross') return 'Slow EMA'
  if (name === 'alma_cross') return 'Slow ALMA'
  if (name === 'lsma_cross') return 'Slow LSMA'
  if (name === 'mcginley_cross') return 'Slow McGinley'
  if (name === 't3_cross') return 'Slow T3'
  if (name === 'trima_cross') return 'Slow TRIMA'
  if (name === 'smma_cross') return 'Slow SMMA'
  if (name === 'vwma_cross') return 'Slow VWMA'
  if (name === 'dema_cross') return 'Slow DEMA'
  if (name === 'zlema_cross') return 'Slow ZLEMA'
  if (name === 'tema_cross') return 'Slow TEMA'
  if (name === 'wma_cross') return 'Slow WMA'
  if (name === 'hma_cross') return 'Slow HMA'
  if (name === 'obv_trend') return 'Slow OBV'
  if (name === 'chaikin_reversal') return 'Slow Chaikin'
  return 'Slow MA'
}

export function getOscillatorPeriodLabel(name: BacktestStrategyName): string {
  if (name === 'stochastic_reversal') return 'Stochastic Period'
  if (name === 'bias_reversal') return 'BIAS Period'
  if (name === 'demarker_reversal') return 'DeMarker Period'
  if (name === 'cfo_reversal') return 'CFO Period'
  if (name === 'smi_reversal') return 'SMI Period'
  if (name === 'awesome_reversal') return 'AO Period'
  if (name === 'schaff_reversal') return 'Schaff Period'
  if (name === 'ultimate_oscillator_reversal') return 'Ultimate Osc Period'
  if (name === 'stochrsi_reversal') return 'StochRSI Period'
  if (name === 'rvi_reversal') return 'RVI Period'
  if (name === 'mfi_reversal') return 'MFI Period'
  if (name === 'cmo_reversal') return 'CMO Period'
  if (name === 'dpo_reversal') return 'DPO Period'
  if (name === 'williams_reversal') return 'Williams %R Period'
  if (name === 'fisher_reversal') return 'Fisher Period'
  return 'RSI Period'
}

export function getThresholdLabels(name: BacktestStrategyName): { period: string; threshold: string } {
  if (name === 'dmi_breakout') {
    return { period: 'DMI Period', threshold: 'Breakout Threshold' }
  }
  if (name === 'chaikin_money_flow_trend') {
    return { period: 'CMF Period', threshold: 'CMF Threshold' }
  }
  if (name === 'chaikin_volatility_trend') {
    return { period: 'Chaikin Vol Period', threshold: 'Volatility Threshold' }
  }
  if (name === 'aroon_trend') {
    return { period: 'Aroon Period', threshold: 'Aroon Threshold' }
  }
  if (name === 'efi_trend') {
    return { period: 'EFI Period', threshold: 'EFI Threshold' }
  }
  if (name === 'vzo_trend') {
    return { period: 'VZO Period', threshold: 'VZO Threshold' }
  }
  if (name === 'vhf_trend') {
    return { period: 'VHF Period', threshold: 'VHF Threshold' }
  }
  if (name === 'kst_trend') {
    return { period: 'KST Period', threshold: 'KST Threshold' }
  }
  if (name === 'pmo_trend') {
    return { period: 'PMO Period', threshold: 'PMO Threshold' }
  }
  if (name === 'roc_breakout') {
    return { period: 'ROC Period', threshold: 'ROC Threshold %' }
  }
  if (name === 'linreg_slope_trend') {
    return { period: 'Slope Period', threshold: 'Slope Threshold %' }
  }
  if (name === 'trix_trend') {
    return { period: 'TRIX Period', threshold: 'TRIX Threshold %' }
  }
  if (name === 'tsi_trend') {
    return { period: 'TSI Period', threshold: 'TSI Threshold' }
  }
  if (name === 'coppock_trend') {
    return { period: 'Coppock Period', threshold: 'Coppock Threshold' }
  }
  if (name === 'vortex_trend') {
    return { period: 'Vortex Period', threshold: 'Vortex Gap' }
  }
  return { period: 'ADX Period', threshold: 'ADX Threshold' }
}
