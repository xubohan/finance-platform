import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MoversPanel from './MoversPanel'

describe('MoversPanel', () => {
  it('renders freshness metadata for cached movers', () => {
    render(
      <MoversPanel
        title="股票动量"
        subtitle="快速切换到当下最活跃标的"
        rows={[{ symbol: 'AAPL', change_pct: 1.2, latest: 100 }]}
        meta={{ source: 'cache', stale: false, as_of: '2026-03-13T00:00:00+00:00', cache_age_sec: 120 }}
        assetType="stock"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText(/来源: 缓存/)).toBeInTheDocument()
    expect(screen.getByText(/新鲜度: 新鲜缓存/)).toBeInTheDocument()
    expect(screen.getByText(/Cache Age: 2m/)).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('renders stale and live freshness states', () => {
    const { rerender } = render(
      <MoversPanel
        title="股票动量"
        subtitle="快速切换到当下最活跃标的"
        rows={[{ symbol: 'AAPL', change_pct: 1.2, latest: 100 }]}
        meta={{ source: 'cache', stale: true, as_of: '2026-03-13T00:00:00+00:00', cache_age_sec: 7200 }}
        assetType="stock"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText(/新鲜度: 过期缓存/)).toBeInTheDocument()

    rerender(
      <MoversPanel
        title="加密动量"
        subtitle="把价格驱动型资产放在同一观察面板"
        rows={[{ symbol: 'BTC', change_pct: 2.3, latest: 70000 }]}
        meta={{ source: 'live', stale: false, as_of: null, cache_age_sec: null }}
        assetType="crypto"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText(/来源: 实时/)).toBeInTheDocument()
    expect(screen.getByText(/新鲜度: 实时/)).toBeInTheDocument()
  })
})
