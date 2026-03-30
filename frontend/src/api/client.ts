import axios from 'axios'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v2',
  timeout: 600000,
})

export function extractApiError(error: unknown, fallback = 'Request failed'): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (detail?.error?.message && typeof detail.error.message === 'string') {
      return detail.error.message
    }
    if (typeof detail === 'string' && detail.trim()) {
      return detail
    }
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message
    }
    return fallback
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return fallback
}

export default client
