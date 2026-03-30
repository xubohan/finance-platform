import client from './client'

export type NewsItem = {
  id: number
  source_id?: string | null
  title: string
  source: string
  content?: string | null
  published_at: string
  symbols: string[]
  categories: string[]
  markets: string[]
  sentiment: number | null
  importance: number
  llm_summary?: string | null
  llm_impact?: string | null
  llm_key_factors?: string[] | null
  processed?: boolean
  created_at?: string
  url?: string | null
}

export type NewsFeedResponse = {
  data: NewsItem[]
  meta: {
    count?: number
    total?: number
    page?: number
    page_size?: number
    market?: 'us' | 'cn' | 'crypto' | 'all'
    markets?: Array<'us' | 'cn' | 'crypto'>
    sentiment_distribution?: {
      positive: number
      neutral: number
      negative: number
    }
    source?: string
    stale?: boolean
    as_of?: string | null
    generated_at?: string
    read_only?: boolean
    ingest_recommended?: boolean
    refresh_supported?: boolean
    refresh_endpoint?: string
  }
}

export type NewsStatsResponse = {
  data: {
    total?: number
    positive_count?: number
    neutral_count?: number
    negative_count?: number
    today?: {
      total?: number
      positive_count?: number
      neutral_count?: number
      negative_count?: number
    }
    week?: {
      total?: number
      positive_count?: number
      neutral_count?: number
      negative_count?: number
    }
  }
  meta: {
    source?: string
    stale?: boolean
    as_of?: string | null
    generated_at?: string
    refresh_supported?: boolean
    refresh_endpoint?: string
  }
}

export async function getNewsFeed(params?: {
  market?: 'us' | 'cn' | 'crypto' | 'all'
  markets?: Array<'us' | 'cn' | 'crypto'>
  query?: string
  symbols?: string
  category?: string | string[]
  sentiment?: 'positive' | 'negative' | 'neutral'
  sentimentMin?: number
  sentimentMax?: number
  importance?: number
  start?: string
  end?: string
  page?: number
  page_size?: number
}) {
  const requestParams = {
    market: params?.market,
    markets: params?.markets?.length ? params.markets.join(',') : undefined,
    query: params?.query,
    symbols: params?.symbols,
    category: Array.isArray(params?.category) ? params.category.join(',') : params?.category,
    sentiment: params?.sentiment,
    sentiment_min: params?.sentimentMin,
    sentiment_max: params?.sentimentMax,
    importance: params?.importance,
    start: params?.start,
    end: params?.end,
    page: params?.page,
    page_size: params?.page_size,
  }
  const resp = await client.get('/news/feed', { params: requestParams })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as NewsFeedResponse
}

export async function getNewsDetail(newsId: number) {
  const resp = await client.get(`/news/${newsId}`)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  }
}

export async function getNewsStats() {
  const resp = await client.get('/news/stats')
  return {
    data: resp.data?.data ?? {},
    meta: resp.data?.meta ?? {},
  } as NewsStatsResponse
}

export async function refreshNews() {
  const resp = await client.post('/news/refresh')
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as {
    data: { status?: string; task?: string; task_id?: string } | null
    meta: { accepted_at?: string }
  }
}

export async function getNewsTask(taskId: string) {
  const resp = await client.get(`/news/tasks/${encodeURIComponent(taskId)}`)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as {
    data: {
      task_id?: string
      status?: string
      result_payload?: unknown
      error?: string
    } | null
    meta: {
      generated_at?: string
      execution_mode?: 'celery'
      task_name?: string
    }
  }
}
