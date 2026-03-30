import { describe, expect, it } from 'vitest'

import { buildStrategyParameters, fallbackStrategyMode } from './backtestParameters'

const baseInputs = {
  fast: 22,
  slow: 11,
  period: 21,
  oversold: -100,
  overbought: 100,
  threshold: 2.5,
  multiplier: 1.8,
}

describe('backtestParameters utils', () => {
  it('maps special strategy payloads consistently', () => {
    expect(buildStrategyParameters('bollinger_reversion', { ...baseInputs, multiplier: 2.2 })).toEqual({
      period: 21,
      stddev: 2.2,
    })
    expect(buildStrategyParameters('donchian_breakout', baseInputs)).toEqual({
      lookback: 22,
      exit_lookback: 11,
    })
    expect(buildStrategyParameters('vwap_reversion', { ...baseInputs, multiplier: 3 })).toEqual({
      period: 21,
      deviation_pct: 3,
    })
    expect(buildStrategyParameters('atr_breakout', { ...baseInputs, multiplier: 2.5 })).toEqual({
      period: 21,
      multiplier: 2.5,
    })
    expect(buildStrategyParameters('cci_reversal', baseInputs)).toEqual({
      period: 21,
      oversold: -100,
      overbought: 100,
    })
  })

  it('keeps fallback parameter modes aligned with strategy families', () => {
    expect(fallbackStrategyMode('buy_hold')).toBe('none')
    expect(fallbackStrategyMode('ema_cross')).toBe('fast_slow')
    expect(fallbackStrategyMode('rsi_reversal')).toBe('oscillator')
    expect(fallbackStrategyMode('adx_trend')).toBe('threshold')
    expect(fallbackStrategyMode('supertrend_follow')).toBe('period_multiplier')
    expect(fallbackStrategyMode('donchian_breakout')).toBe('special')
  })
})
