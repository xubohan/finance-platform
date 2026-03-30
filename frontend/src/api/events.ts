import client from './client'

export type EventItem = {
  id: number
  title: string
  event_type: string
  event_date: string
  event_time?: string | null
  symbols?: string[]
  markets?: string[]
  description?: string | null
  importance?: number
  source?: string | null
  source_url?: string | null
  created_at?: string
}

export type EventDetailItem = EventItem & {
  created_at?: string
}

export async function getEventCalendar(params?: {
  start?: string
  end?: string
  market?: string
  event_type?: string
}) {
  const resp = await client.get('/events/calendar', { params })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: EventItem[]
    meta: {
      count?: number
      source?: string
      stale?: boolean
      as_of?: string | null
      read_only?: boolean
      refresh_supported?: boolean
      refresh_endpoint?: string
      backfill_endpoint?: string
      generated_at?: string
    }
  }
}

export async function searchEvents(payload: {
  query: string
  event_type?: string | null
  date_range?: string[]
}) {
  const resp = await client.post('/events/search', payload)
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: EventItem[]
    meta: {
      count?: number
      source?: string
      stale?: boolean
      as_of?: string | null
      read_only?: boolean
      refresh_supported?: boolean
      refresh_endpoint?: string
      generated_at?: string
    }
  }
}

export async function getEventHistory(params?: {
  event_type?: string
  symbol?: string
  limit?: number
}) {
  const resp = await client.get('/events/history', { params })
  return {
    data: resp.data?.data ?? [],
    meta: resp.data?.meta ?? {},
  } as {
    data: EventItem[]
    meta: {
      count?: number
      source?: string
      stale?: boolean
      as_of?: string | null
      generated_at?: string
      read_only?: boolean
      refresh_supported?: boolean
      refresh_endpoint?: string
    }
  }
}

export async function getEventImpact(eventId: number) {
  const resp = await client.get(`/events/${eventId}/impact`)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as {
    data: {
      event_id: number
      event_title: string
      event_date: string
      impact_by_symbol: Array<{
        symbol: string
        asset_type?: string
        t_minus_5d_ret?: number | null
        t_minus_1d_ret?: number | null
        t_plus_1d_ret?: number | null
        t_plus_3d_ret?: number | null
        t_plus_5d_ret?: number | null
        t_plus_20d_ret?: number | null
        vol_ratio_1d?: number | null
        max_drawdown?: number | null
      }>
    } | null
    meta: {
      generated_at?: string
      source?: string
      as_of?: string | null
      stale?: boolean
      read_only?: boolean
      refresh_supported?: boolean
      backfill_endpoint?: string
    }
  }
}

export async function getEventDetail(eventId: number) {
  const resp = await client.get(`/events/${eventId}`)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as {
    data: EventDetailItem | null
    meta: {
      generated_at?: string
      source?: string
      as_of?: string | null
      stale?: boolean
      read_only?: boolean
      refresh_supported?: boolean
      refresh_endpoint?: string
      backfill_endpoint?: string
    }
  }
}

export async function backfillEventImpact(eventId: number) {
  const resp = await client.post(`/events/${eventId}/impact/backfill`)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as {
    data: {
      event_id?: number
      status?: string
      symbols?: string[]
      inserted_records?: number
    } | null
    meta: {
      execution_mode?: string
      accepted_at?: string
    }
  }
}

export async function refreshEvents() {
  const resp = await client.post('/events/refresh')
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as {
    data: {
      status?: string
      task?: string
      task_id?: string
    } | null
    meta: {
      accepted_at?: string
      execution_mode?: string
    }
  }
}

export async function getEventTask(taskId: string) {
  const resp = await client.get(`/events/tasks/${encodeURIComponent(taskId)}`)
  return {
    data: resp.data?.data ?? null,
    meta: resp.data?.meta ?? {},
  } as {
    data: {
      task_id?: string
      status?: string
      result_payload?: Record<string, unknown> | null
      error?: string
    } | null
    meta: {
      generated_at?: string
      execution_mode?: string
      task_name?: string
    }
  }
}
