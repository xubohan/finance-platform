import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import WatchlistSnapshotPanel from './WatchlistSnapshotPanel'

describe('WatchlistSnapshotPanel', () => {
  it('switches to relative mode and displays baseline comparison', async () => {
    render(
      <WatchlistSnapshotPanel
        rows={[
          { symbol: 'AAPL', name: 'Apple', asset_type: 'stock', market: 'US', price: 100, change_pct_24h: 1.2 },
          { symbol: 'MSFT', name: 'Microsoft', asset_type: 'stock', market: 'US', price: 110, change_pct_24h: 0.8 },
        ]}
        loading={false}
        error={null}
        selectedAsset={{ symbol: 'AAPL', name: 'Apple', asset_type: 'stock', market: 'US' }}
        onSelect={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '对比模式' }))

    expect(screen.getByText('对比基准: AAPL')).toBeInTheDocument()
    expect(screen.getByText('10.00% vs AAPL')).toBeInTheDocument()
  })
})
