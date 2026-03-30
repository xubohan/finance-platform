export const QUERY_REFRESH_MS = {
  shellRuntime: 15_000,
  dashboardFast: 15_000,
  dashboardNews: 30_000,
  dashboardSlow: 60_000,
  marketStockQuote: 15_000,
  marketCryptoQuote: 5_000,
  marketStockChart: 20_000,
  marketCryptoChart: 10_000,
  marketContext: 30_000,
  marketSlow: 60_000,
  newsFeed: 30_000,
  newsStats: 30_000,
  screener: 60_000,
  events: 60_000,
} as const

export const BACKGROUND_REFRESH_QUERY_OPTIONS = {
  refetchIntervalInBackground: true,
} as const

export function getMarketQuoteRefreshMs(assetType: 'stock' | 'crypto') {
  return assetType === 'crypto' ? QUERY_REFRESH_MS.marketCryptoQuote : QUERY_REFRESH_MS.marketStockQuote
}

export function getMarketChartRefreshMs(assetType: 'stock' | 'crypto') {
  return assetType === 'crypto' ? QUERY_REFRESH_MS.marketCryptoChart : QUERY_REFRESH_MS.marketStockChart
}
