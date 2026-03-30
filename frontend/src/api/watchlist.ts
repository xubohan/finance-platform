import client from './client'

export type WatchlistItem = {
  symbol: string
  asset_type: 'stock' | 'crypto'
  name?: string | null
  sort_order?: number
  added_at?: string
}

export async function getWatchlist() {
  const resp = await client.get('/watchlist')
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as { data: WatchlistItem[]; meta: { count?: number } }
}

export async function addWatchlistItem(payload: WatchlistItem) {
  const resp = await client.post('/watchlist', payload)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as { data: WatchlistItem | null; meta: { created?: boolean } }
}

export async function removeWatchlistItem(symbol: string, assetType?: 'stock' | 'crypto') {
  const resp = await client.delete(`/watchlist/${encodeURIComponent(symbol)}`, {
    params: assetType ? { asset_type: assetType } : undefined,
  })
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  }
}

export async function getWatchlistQuotes() {
  const resp = await client.get('/watchlist/quotes')
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: Array<
      WatchlistItem & {
        price?: number
        change_pct_24h?: number
        source?: string | null
        fetch_source?: string | null
        stale?: boolean | null
        as_of?: string | null
        error?: string | null
      }
    >
    meta: {
      count?: number
      success_count?: number
      failed_count?: number
      stale_count?: number
      fresh_count?: number
      providers?: string[]
      sources?: string[]
      as_of?: string | null
    }
  }
}
