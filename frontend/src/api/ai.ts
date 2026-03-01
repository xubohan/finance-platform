import client from './client'

export async function runAI(symbol: string): Promise<{ task_id: string; status: string }> {
  const resp = await client.post('/ai/run', { symbol })
  return resp.data
}

export async function getAIResult(taskId: string) {
  const resp = await client.get(`/ai/result/${taskId}`)
  return resp.data?.data
}

export function subscribeAI(taskId: string, onMessage: (payload: any) => void) {
  const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'
  const url = `${base}/ai/stream/${taskId}`
  const es = new EventSource(url)
  es.onmessage = (evt) => {
    try {
      onMessage(JSON.parse(evt.data))
    } catch {
      // ignore malformed payloads
    }
  }
  return es
}
