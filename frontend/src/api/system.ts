import client from './client'

export type HealthResponse = {
  status?: string
  research_apis?: boolean
  ai_api?: boolean
}

export async function getHealth() {
  const resp = await client.get('/health')
  return (resp.data ?? {}) as HealthResponse
}
