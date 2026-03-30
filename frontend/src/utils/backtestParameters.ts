import type { BacktestStrategyCatalogEntry } from '../api/backtest'
import {
  isFastSlowStrategy,
  isOscillatorStrategy,
  isPeriodMultiplierStrategy,
  isThresholdStrategy,
  type BacktestStrategyName,
} from './backtestStrategies'

export type BacktestParameterInputs = {
  fast: number
  slow: number
  period: number
  oversold: number
  overbought: number
  threshold: number
  multiplier: number
}

export function fallbackStrategyMode(name: BacktestStrategyName): BacktestStrategyCatalogEntry['parameter_mode'] {
  if (isFastSlowStrategy(name)) return 'fast_slow'
  if (isOscillatorStrategy(name)) return 'oscillator'
  if (isThresholdStrategy(name)) return 'threshold'
  if (isPeriodMultiplierStrategy(name)) return 'period_multiplier'
  if (name === 'buy_hold') return 'none'
  return 'special'
}

export function buildStrategyParameters(
  name: BacktestStrategyName,
  inputs: BacktestParameterInputs,
): Record<string, number> {
  const parameters: Record<string, number> = {}

  if (isFastSlowStrategy(name)) {
    parameters.fast = inputs.fast
    parameters.slow = inputs.slow
  }
  if (isOscillatorStrategy(name)) {
    parameters.period = inputs.period
    parameters.oversold = inputs.oversold
    parameters.overbought = inputs.overbought
  }
  if (name === 'bollinger_reversion') {
    parameters.period = inputs.period
    parameters.stddev = inputs.multiplier
  }
  if (isPeriodMultiplierStrategy(name)) {
    parameters.period = inputs.period
    parameters.multiplier = inputs.multiplier
  }
  if (name === 'vwap_reversion') {
    parameters.period = inputs.period
    parameters.deviation_pct = inputs.multiplier
  }
  if (name === 'atr_breakout') {
    parameters.period = inputs.period
    parameters.multiplier = inputs.multiplier
  }
  if (name === 'donchian_breakout') {
    parameters.lookback = inputs.fast
    parameters.exit_lookback = inputs.slow
  }
  if (isThresholdStrategy(name)) {
    parameters.period = inputs.period
    parameters.threshold = inputs.threshold
  }
  if (name === 'cci_reversal') {
    parameters.period = inputs.period
    parameters.oversold = inputs.oversold
    parameters.overbought = inputs.overbought
  }

  return parameters
}
