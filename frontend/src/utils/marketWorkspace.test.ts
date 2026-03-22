import { describe, expect, it } from 'vitest'

import {
  createDefaultWorkspaceState,
  mergeRecentAssets,
  parseRecentAssets,
  parseWorkspaceState,
} from './marketWorkspace'

describe('marketWorkspace utils', () => {
  it('filters invalid recent assets from localStorage payloads', () => {
    const assets = parseRecentAssets(
      JSON.stringify([
        { symbol: 'btc', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' },
        { symbol: 'bad', name: 'Broken', asset_type: 'broken' },
      ]),
    )

    expect(assets).toHaveLength(1)
    expect(assets[0].symbol).toBe('BTC')
  })

  it('parses workspace state with semantic validation', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        selectedAsset: { symbol: 'msft', name: 'Microsoft', asset_type: 'stock', market: 'US' },
        searchScope: 'stock',
        period: '1d',
        chartStartDate: '2026-01-01',
        chartEndDate: '2026-01-31',
        strategyName: 'ma_cross',
        fast: 10,
        slow: 30,
        initialCapital: 200000,
        syncIfMissing: false,
      }),
    )

    expect(state.selectedAsset?.symbol).toBe('MSFT')
    expect(state.fast).toBe(10)
    expect(state.searchScope).toBe('stock')
    expect(state.syncIfMissing).toBe(false)
  })

  it('accepts newly added strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'bollinger_reversion',
        rsiPeriod: 21,
        oversold: 2.5,
      }),
    )

    expect(state.strategyName).toBe('bollinger_reversion')
    expect(state.rsiPeriod).toBe(21)
    expect(state.oversold).toBe(2.5)
  })

  it('accepts compare strategy pool in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        compareStrategyNames: ['buy_hold', 'ema_cross', 'macd_signal'],
        compareRankingMetric: 'sharpe_ratio',
      }),
    )

    expect(state.compareStrategyNames).toEqual(['buy_hold', 'ema_cross', 'macd_signal'])
    expect(state.compareRankingMetric).toBe('sharpe_ratio')
  })

  it('preserves an explicitly empty compare strategy pool', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        compareStrategyNames: [],
      }),
    )

    expect(state.compareStrategyNames).toEqual([])
  })

  it('accepts ema and oscillator strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'mfi_reversal',
        rsiPeriod: 14,
        oversold: 20,
        overbought: 80,
      }),
    )

    expect(state.strategyName).toBe('mfi_reversal')
    expect(state.rsiPeriod).toBe(14)
    expect(state.overbought).toBe(80)
  })

  it('accepts dema and zlema strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'dema_cross',
        fast: 5,
        slow: 20,
      }),
    )

    expect(state.strategyName).toBe('dema_cross')
    expect(state.fast).toBe(5)
    expect(state.slow).toBe(20)
  })

  it('accepts alma and trima strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'alma_cross',
        fast: 9,
        slow: 21,
      }),
    )

    expect(state.strategyName).toBe('alma_cross')
    expect(state.fast).toBe(9)
    expect(state.slow).toBe(21)
  })

  it('accepts lsma strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'lsma_cross',
        fast: 9,
        slow: 21,
      }),
    )

    expect(state.strategyName).toBe('lsma_cross')
    expect(state.fast).toBe(9)
    expect(state.slow).toBe(21)
  })

  it('accepts mcginley strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'mcginley_cross',
        fast: 8,
        slow: 21,
      }),
    )

    expect(state.strategyName).toBe('mcginley_cross')
    expect(state.fast).toBe(8)
    expect(state.slow).toBe(21)
  })

  it('accepts t3 strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 't3_cross',
        fast: 5,
        slow: 20,
      }),
    )

    expect(state.strategyName).toBe('t3_cross')
    expect(state.fast).toBe(5)
    expect(state.slow).toBe(20)
  })

  it('accepts smma and vwma strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'smma_cross',
        fast: 5,
        slow: 20,
      }),
    )

    expect(state.strategyName).toBe('smma_cross')
    expect(state.fast).toBe(5)
    expect(state.slow).toBe(20)
  })

  it('accepts wma and cmo strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'cmo_reversal',
        rsiPeriod: 14,
        oversold: -50,
        overbought: 50,
      }),
    )

    expect(state.strategyName).toBe('cmo_reversal')
    expect(state.oversold).toBe(-50)
    expect(state.overbought).toBe(50)
  })

  it('accepts fisher strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'fisher_reversal',
        rsiPeriod: 10,
        oversold: -1.5,
        overbought: 1.5,
      }),
    )

    expect(state.strategyName).toBe('fisher_reversal')
    expect(state.oversold).toBe(-1.5)
    expect(state.overbought).toBe(1.5)
  })

  it('accepts schaff strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'schaff_reversal',
        rsiPeriod: 14,
        oversold: 25,
        overbought: 75,
      }),
    )

    expect(state.strategyName).toBe('schaff_reversal')
    expect(state.oversold).toBe(25)
    expect(state.overbought).toBe(75)
  })

  it('accepts awesome strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'awesome_reversal',
        rsiPeriod: 14,
        oversold: -1,
        overbought: 1,
      }),
    )

    expect(state.strategyName).toBe('awesome_reversal')
    expect(state.oversold).toBe(-1)
    expect(state.overbought).toBe(1)
  })

  it('accepts cfo strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'cfo_reversal',
        rsiPeriod: 14,
        oversold: -2,
        overbought: 2,
      }),
    )

    expect(state.strategyName).toBe('cfo_reversal')
    expect(state.oversold).toBe(-2)
    expect(state.overbought).toBe(2)
  })

  it('accepts demarker and rvi strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'rvi_reversal',
        rsiPeriod: 10,
        oversold: -0.2,
        overbought: 0.2,
      }),
    )

    expect(state.strategyName).toBe('rvi_reversal')
    expect(state.oversold).toBe(-0.2)
    expect(state.overbought).toBe(0.2)
  })

  it('accepts smi strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'smi_reversal',
        rsiPeriod: 14,
        oversold: -40,
        overbought: 40,
      }),
    )

    expect(state.strategyName).toBe('smi_reversal')
    expect(state.oversold).toBe(-40)
    expect(state.overbought).toBe(40)
  })

  it('accepts bias strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'bias_reversal',
        rsiPeriod: 14,
        oversold: -5,
        overbought: 5,
      }),
    )

    expect(state.strategyName).toBe('bias_reversal')
    expect(state.oversold).toBe(-5)
    expect(state.overbought).toBe(5)
  })

  it('accepts dpo strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'dpo_reversal',
        rsiPeriod: 20,
        oversold: -2,
        overbought: 2,
      }),
    )

    expect(state.strategyName).toBe('dpo_reversal')
    expect(state.oversold).toBe(-2)
    expect(state.overbought).toBe(2)
  })

  it('accepts williams strategy names with negative thresholds in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'williams_reversal',
        rsiPeriod: 14,
        oversold: -80,
        overbought: -20,
      }),
    )

    expect(state.strategyName).toBe('williams_reversal')
    expect(state.oversold).toBe(-80)
    expect(state.overbought).toBe(-20)
  })

  it('restores persisted backtest trade page', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        backtestTradesPage: 3,
      }),
    )

    expect(state.backtestTradesPage).toBe(3)
  })

  it('accepts channel and trend strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'supertrend_follow',
        rsiPeriod: 10,
        oversold: 2,
      }),
    )

    expect(state.strategyName).toBe('supertrend_follow')
    expect(state.rsiPeriod).toBe(10)
    expect(state.oversold).toBe(2)
  })

  it('accepts adx and keltner strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'adx_trend',
        rsiPeriod: 14,
        oversold: 25,
      }),
    )

    expect(state.strategyName).toBe('adx_trend')
    expect(state.rsiPeriod).toBe(14)
    expect(state.oversold).toBe(25)
  })

  it('accepts cmf, aroon and roc strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'chaikin_money_flow_trend',
        rsiPeriod: 20,
        oversold: 0.05,
      }),
    )

    expect(state.strategyName).toBe('chaikin_money_flow_trend')
    expect(state.rsiPeriod).toBe(20)
    expect(state.oversold).toBe(0.05)
  })

  it('accepts trix strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'trix_trend',
        rsiPeriod: 15,
        oversold: 0.2,
      }),
    )

    expect(state.strategyName).toBe('trix_trend')
    expect(state.rsiPeriod).toBe(15)
    expect(state.oversold).toBe(0.2)
  })

  it('accepts coppock strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'coppock_trend',
        rsiPeriod: 14,
        oversold: 0.5,
      }),
    )

    expect(state.strategyName).toBe('coppock_trend')
    expect(state.rsiPeriod).toBe(14)
    expect(state.oversold).toBe(0.5)
  })

  it('accepts tsi strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'tsi_trend',
        rsiPeriod: 13,
        oversold: 10,
      }),
    )

    expect(state.strategyName).toBe('tsi_trend')
    expect(state.rsiPeriod).toBe(13)
    expect(state.oversold).toBe(10)
  })

  it('accepts kst strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'kst_trend',
        rsiPeriod: 10,
        oversold: 5,
      }),
    )

    expect(state.strategyName).toBe('kst_trend')
    expect(state.rsiPeriod).toBe(10)
    expect(state.oversold).toBe(5)
  })

  it('accepts efi strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'efi_trend',
        rsiPeriod: 13,
        oversold: 1000,
      }),
    )

    expect(state.strategyName).toBe('efi_trend')
    expect(state.rsiPeriod).toBe(13)
    expect(state.oversold).toBe(1000)
  })

  it('accepts vhf strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'vhf_trend',
        rsiPeriod: 14,
        oversold: 0.4,
      }),
    )

    expect(state.strategyName).toBe('vhf_trend')
    expect(state.rsiPeriod).toBe(14)
    expect(state.oversold).toBe(0.4)
  })

  it('accepts vzo and pmo strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'pmo_trend',
        rsiPeriod: 12,
        oversold: 0.5,
      }),
    )

    expect(state.strategyName).toBe('pmo_trend')
    expect(state.rsiPeriod).toBe(12)
    expect(state.oversold).toBe(0.5)
  })

  it('accepts chaikin volatility and linreg slope strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'linreg_slope_trend',
        rsiPeriod: 14,
        oversold: 0.3,
      }),
    )

    expect(state.strategyName).toBe('linreg_slope_trend')
    expect(state.rsiPeriod).toBe(14)
    expect(state.oversold).toBe(0.3)
  })

  it('accepts vortex strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'vortex_trend',
        rsiPeriod: 14,
        oversold: 0.1,
      }),
    )

    expect(state.strategyName).toBe('vortex_trend')
    expect(state.rsiPeriod).toBe(14)
    expect(state.oversold).toBe(0.1)
  })

  it('accepts vwap and cci strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'cci_reversal',
        rsiPeriod: 20,
        oversold: -100,
        overbought: 100,
      }),
    )

    expect(state.strategyName).toBe('cci_reversal')
    expect(state.rsiPeriod).toBe(20)
    expect(state.overbought).toBe(100)
  })

  it('accepts obv and chaikin strategy names in persisted workspace state', () => {
    const state = parseWorkspaceState(
      JSON.stringify({
        strategyName: 'chaikin_reversal',
        fast: 3,
        slow: 10,
      }),
    )

    expect(state.strategyName).toBe('chaikin_reversal')
    expect(state.fast).toBe(3)
    expect(state.slow).toBe(10)
  })

  it('merges recent assets without duplicating the same asset', () => {
    const defaults = createDefaultWorkspaceState()
    const merged = mergeRecentAssets(defaults.selectedAsset, [
      defaults.selectedAsset,
      { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' },
    ])

    expect(merged).toHaveLength(2)
    expect(merged[0].symbol).toBe('AAPL')
    expect(merged[1].symbol).toBe('BTC')
  })
})
