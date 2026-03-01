import client from './client'

export type ScreenerParams = {
  min_pe?: number
  max_pe?: number
  min_roe?: number
  min_profit_yoy?: number
  limit?: number
}

export async function runScreener(params: ScreenerParams) {
  const resp = await client.post('/screener/run', params)
  return resp.data?.data ?? []
}
