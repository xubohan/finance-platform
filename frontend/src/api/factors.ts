import client from './client'

export type FactorWeights = {
  value: number
  growth: number
  momentum: number
  quality: number
}

export async function scoreFactors(weights: FactorWeights, topN = 50) {
  const resp = await client.post('/factors/score', {
    weights,
    top_n: topN,
  })
  return resp.data?.data ?? []
}
