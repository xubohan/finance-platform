import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useWorkspaceStorage } from './useWorkspaceStorage'

describe('useWorkspaceStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('restores persisted workspace state on initialization', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        selectedAsset: { symbol: 'BTC', name: 'Bitcoin', asset_type: 'crypto', market: 'CRYPTO' },
        searchScope: 'crypto',
        period: '1M',
        strategyName: 'rsi_reversal',
        syncIfMissing: false,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.selectedAsset.symbol).toBe('BTC')
    expect(result.current.searchScope).toBe('crypto')
    expect(result.current.period).toBe('1M')
    expect(result.current.strategyName).toBe('rsi_reversal')
    expect(result.current.syncIfMissing).toBe(false)
  })

  it('restores compare strategy pool from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        compareStrategyNames: ['buy_hold', 'ema_cross', 'macd_signal'],
        compareRankingMetric: 'sharpe_ratio',
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.compareStrategyNames).toEqual(['buy_hold', 'ema_cross', 'macd_signal'])
    expect(result.current.compareRankingMetric).toBe('sharpe_ratio')
  })

  it('restores newly added strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'donchian_breakout',
        fast: 22,
        slow: 11,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('donchian_breakout')
    expect(result.current.fast).toBe(22)
    expect(result.current.slow).toBe(11)
  })

  it('restores ema and oscillator strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'ema_cross',
        fast: 8,
        slow: 21,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('ema_cross')
    expect(result.current.fast).toBe(8)
    expect(result.current.slow).toBe(21)
  })

  it('restores dema strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'dema_cross',
        fast: 5,
        slow: 20,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('dema_cross')
    expect(result.current.fast).toBe(5)
    expect(result.current.slow).toBe(20)
  })

  it('restores smma strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'smma_cross',
        fast: 5,
        slow: 20,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('smma_cross')
    expect(result.current.fast).toBe(5)
    expect(result.current.slow).toBe(20)
  })

  it('restores alma strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'alma_cross',
        fast: 9,
        slow: 21,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('alma_cross')
    expect(result.current.fast).toBe(9)
    expect(result.current.slow).toBe(21)
  })

  it('restores lsma strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'lsma_cross',
        fast: 9,
        slow: 21,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('lsma_cross')
    expect(result.current.fast).toBe(9)
    expect(result.current.slow).toBe(21)
  })

  it('restores mcginley strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'mcginley_cross',
        fast: 8,
        slow: 21,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('mcginley_cross')
    expect(result.current.fast).toBe(8)
    expect(result.current.slow).toBe(21)
  })

  it('restores t3 strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 't3_cross',
        fast: 5,
        slow: 20,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('t3_cross')
    expect(result.current.fast).toBe(5)
    expect(result.current.slow).toBe(20)
  })

  it('restores trima strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'trima_cross',
        fast: 5,
        slow: 20,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('trima_cross')
    expect(result.current.fast).toBe(5)
    expect(result.current.slow).toBe(20)
  })

  it('restores vwma strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'vwma_cross',
        fast: 5,
        slow: 20,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('vwma_cross')
    expect(result.current.fast).toBe(5)
    expect(result.current.slow).toBe(20)
  })

  it('restores zlema strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'zlema_cross',
        fast: 5,
        slow: 20,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('zlema_cross')
    expect(result.current.fast).toBe(5)
    expect(result.current.slow).toBe(20)
  })

  it('restores cmo strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'cmo_reversal',
        rsiPeriod: 14,
        oversold: -50,
        overbought: 50,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('cmo_reversal')
    expect(result.current.oversold).toBe(-50)
    expect(result.current.overbought).toBe(50)
  })

  it('restores fisher strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'fisher_reversal',
        rsiPeriod: 10,
        oversold: -1.5,
        overbought: 1.5,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('fisher_reversal')
    expect(result.current.oversold).toBe(-1.5)
    expect(result.current.overbought).toBe(1.5)
  })

  it('restores schaff strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'schaff_reversal',
        rsiPeriod: 14,
        oversold: 25,
        overbought: 75,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('schaff_reversal')
    expect(result.current.oversold).toBe(25)
    expect(result.current.overbought).toBe(75)
  })

  it('restores awesome strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'awesome_reversal',
        rsiPeriod: 14,
        oversold: -1,
        overbought: 1,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('awesome_reversal')
    expect(result.current.oversold).toBe(-1)
    expect(result.current.overbought).toBe(1)
  })

  it('restores cfo strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'cfo_reversal',
        rsiPeriod: 14,
        oversold: -2,
        overbought: 2,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('cfo_reversal')
    expect(result.current.oversold).toBe(-2)
    expect(result.current.overbought).toBe(2)
  })

  it('restores demarker strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'demarker_reversal',
        rsiPeriod: 14,
        oversold: 30,
        overbought: 70,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('demarker_reversal')
    expect(result.current.oversold).toBe(30)
    expect(result.current.overbought).toBe(70)
  })

  it('restores smi strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'smi_reversal',
        rsiPeriod: 14,
        oversold: -40,
        overbought: 40,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('smi_reversal')
    expect(result.current.oversold).toBe(-40)
    expect(result.current.overbought).toBe(40)
  })

  it('restores bias strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'bias_reversal',
        rsiPeriod: 14,
        oversold: -5,
        overbought: 5,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('bias_reversal')
    expect(result.current.oversold).toBe(-5)
    expect(result.current.overbought).toBe(5)
  })

  it('restores rvi strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'rvi_reversal',
        rsiPeriod: 10,
        oversold: -0.2,
        overbought: 0.2,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('rvi_reversal')
    expect(result.current.oversold).toBe(-0.2)
    expect(result.current.overbought).toBe(0.2)
  })

  it('restores dpo strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'dpo_reversal',
        rsiPeriod: 20,
        oversold: -2,
        overbought: 2,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('dpo_reversal')
    expect(result.current.oversold).toBe(-2)
    expect(result.current.overbought).toBe(2)
  })

  it('restores williams strategy names with negative thresholds from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'williams_reversal',
        rsiPeriod: 14,
        oversold: -80,
        overbought: -20,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('williams_reversal')
    expect(result.current.oversold).toBe(-80)
    expect(result.current.overbought).toBe(-20)
  })

  it('restores backtest trade page from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        backtestTradesPage: 3,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.backtestTradesPage).toBe(3)
  })

  it('restores supertrend strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'supertrend_follow',
        rsiPeriod: 10,
        oversold: 2,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('supertrend_follow')
    expect(result.current.rsiPeriod).toBe(10)
    expect(result.current.oversold).toBe(2)
  })

  it('restores adx strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'adx_trend',
        rsiPeriod: 14,
        oversold: 25,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('adx_trend')
    expect(result.current.rsiPeriod).toBe(14)
    expect(result.current.oversold).toBe(25)
  })

  it('restores cmf strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'chaikin_money_flow_trend',
        rsiPeriod: 20,
        oversold: 0.05,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('chaikin_money_flow_trend')
    expect(result.current.rsiPeriod).toBe(20)
    expect(result.current.oversold).toBe(0.05)
  })

  it('restores trix strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'trix_trend',
        rsiPeriod: 15,
        oversold: 0.2,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('trix_trend')
    expect(result.current.rsiPeriod).toBe(15)
    expect(result.current.oversold).toBe(0.2)
  })

  it('restores coppock strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'coppock_trend',
        rsiPeriod: 14,
        oversold: 0.5,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('coppock_trend')
    expect(result.current.rsiPeriod).toBe(14)
    expect(result.current.oversold).toBe(0.5)
  })

  it('restores tsi strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'tsi_trend',
        rsiPeriod: 13,
        oversold: 10,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('tsi_trend')
    expect(result.current.rsiPeriod).toBe(13)
    expect(result.current.oversold).toBe(10)
  })

  it('restores kst strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'kst_trend',
        rsiPeriod: 10,
        oversold: 5,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('kst_trend')
    expect(result.current.rsiPeriod).toBe(10)
    expect(result.current.oversold).toBe(5)
  })

  it('restores efi strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'efi_trend',
        rsiPeriod: 13,
        oversold: 1000,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('efi_trend')
    expect(result.current.rsiPeriod).toBe(13)
    expect(result.current.oversold).toBe(1000)
  })

  it('restores vhf strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'vhf_trend',
        rsiPeriod: 14,
        oversold: 0.4,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('vhf_trend')
    expect(result.current.rsiPeriod).toBe(14)
    expect(result.current.oversold).toBe(0.4)
  })

  it('restores vzo strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'vzo_trend',
        rsiPeriod: 14,
        oversold: 15,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('vzo_trend')
    expect(result.current.rsiPeriod).toBe(14)
    expect(result.current.oversold).toBe(15)
  })

  it('restores chaikin volatility strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'chaikin_volatility_trend',
        rsiPeriod: 10,
        oversold: 10,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('chaikin_volatility_trend')
    expect(result.current.rsiPeriod).toBe(10)
    expect(result.current.oversold).toBe(10)
  })

  it('restores linreg slope strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'linreg_slope_trend',
        rsiPeriod: 14,
        oversold: 0.3,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('linreg_slope_trend')
    expect(result.current.rsiPeriod).toBe(14)
    expect(result.current.oversold).toBe(0.3)
  })

  it('restores pmo strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'pmo_trend',
        rsiPeriod: 12,
        oversold: 0.5,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('pmo_trend')
    expect(result.current.rsiPeriod).toBe(12)
    expect(result.current.oversold).toBe(0.5)
  })

  it('restores vortex strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'vortex_trend',
        rsiPeriod: 14,
        oversold: 0.1,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('vortex_trend')
    expect(result.current.rsiPeriod).toBe(14)
    expect(result.current.oversold).toBe(0.1)
  })

  it('restores cci strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'cci_reversal',
        rsiPeriod: 20,
        oversold: -100,
        overbought: 100,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('cci_reversal')
    expect(result.current.rsiPeriod).toBe(20)
    expect(result.current.overbought).toBe(100)
  })

  it('restores chaikin strategy names from persisted workspace state', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        strategyName: 'chaikin_reversal',
        fast: 3,
        slow: 10,
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    expect(result.current.strategyName).toBe('chaikin_reversal')
    expect(result.current.fast).toBe(3)
    expect(result.current.slow).toBe(10)
  })

  it('applyInputAsset uses current input and scope to build the selected asset', () => {
    const { result } = renderHook(() => useWorkspaceStorage())

    act(() => {
      result.current.setSearchScope('crypto')
      result.current.setSearchInput('eth')
    })

    let asset = null
    act(() => {
      asset = result.current.applyInputAsset()
    })

    expect(asset).toEqual({
      symbol: 'ETH',
      name: 'ETH',
      asset_type: 'crypto',
      market: 'CRYPTO',
    })
    expect(result.current.selectedAsset.symbol).toBe('ETH')
  })

  it('resetWorkspace restores default values', () => {
    const { result } = renderHook(() => useWorkspaceStorage())

    act(() => {
      result.current.setSearchScope('crypto')
      result.current.setSearchInput('BTC')
      result.current.toggleIndicator('RSI')
      result.current.setSyncIfMissing(false)
      result.current.resetWorkspace()
    })

    expect(result.current.selectedAsset.symbol).toBe('AAPL')
    expect(result.current.searchScope).toBe('all')
    expect(result.current.searchInput).toBe('AAPL')
    expect(result.current.selectedIndicators).toEqual(['MA'])
    expect(result.current.syncIfMissing).toBe(true)
    expect(result.current.compareStrategyNames).toEqual(['buy_hold', 'ma_cross', 'ema_cross', 'macd_signal', 'rsi_reversal'])
    expect(result.current.compareRankingMetric).toBe('total_return')
  })

  it('toggleCompareStrategy adds and removes compare pool entries', () => {
    const { result } = renderHook(() => useWorkspaceStorage())

    act(() => {
      result.current.toggleCompareStrategy('buy_hold')
    })
    expect(result.current.compareStrategyNames).not.toContain('buy_hold')

    act(() => {
      result.current.toggleCompareStrategy('buy_hold')
    })
    expect(result.current.compareStrategyNames).toContain('buy_hold')
  })

  it('toggleCompareStrategy stops growing after eight custom entries', () => {
    window.localStorage.setItem(
      'market-workspace:state',
      JSON.stringify({
        compareStrategyNames: [
          'buy_hold',
          'ma_cross',
          'ema_cross',
          'macd_signal',
          'rsi_reversal',
          'bollinger_reversion',
          'donchian_breakout',
          'supertrend_follow',
        ],
      }),
    )

    const { result } = renderHook(() => useWorkspaceStorage())

    act(() => {
      result.current.toggleCompareStrategy('adx_trend')
    })

    expect(result.current.compareStrategyNames).toEqual([
      'buy_hold',
      'ma_cross',
      'ema_cross',
      'macd_signal',
      'rsi_reversal',
      'bollinger_reversion',
      'donchian_breakout',
      'supertrend_follow',
    ])
  })

  it('replaceCompareStrategies applies deduped templates and supports empty pools', () => {
    const { result } = renderHook(() => useWorkspaceStorage())

    act(() => {
      result.current.replaceCompareStrategies(['ema_cross', 'ema_cross', 'adx_trend', 'buy_hold'])
    })

    expect(result.current.compareStrategyNames).toEqual(['ema_cross', 'adx_trend', 'buy_hold'])

    act(() => {
      result.current.replaceCompareStrategies([])
    })

    expect(result.current.compareStrategyNames).toEqual([])
  })

  it('selectMoverAsset updates the selected asset and search input together', () => {
    const { result } = renderHook(() => useWorkspaceStorage())

    let asset = null
    act(() => {
      asset = result.current.selectMoverAsset('BTC', 'crypto')
    })

    expect(asset).toEqual({
      symbol: 'BTC',
      name: 'BTC',
      asset_type: 'crypto',
      market: 'CRYPTO',
    })
    expect(result.current.selectedAsset.symbol).toBe('BTC')
    expect(result.current.searchInput).toBe('BTC')
  })
})
