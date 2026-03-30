import { QueryObserver, focusManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BACKGROUND_REFRESH_QUERY_OPTIONS } from './lib/query-refresh'
import { APP_QUERY_DEFAULT_OPTIONS, createAppQueryClient, renderApp } from './main'

describe('app query client defaults', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    focusManager.setFocused(true)
  })

  afterEach(() => {
    focusManager.setFocused(true)
    vi.useRealTimers()
  })

  it('disables background refetching in the shared query client factory by default', () => {
    const queryClient = createAppQueryClient()

    expect(APP_QUERY_DEFAULT_OPTIONS.queries?.refetchIntervalInBackground).toBe(false)
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(15_000)
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(5 * 60_000)
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(1)
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true)
    expect(queryClient.getDefaultOptions().queries?.refetchOnReconnect).toBe(true)
    expect(queryClient.getDefaultOptions().queries?.refetchIntervalInBackground).toBe(false)
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(0)
  })

  it('pauses interval queries while the app is unfocused unless a query opts in', async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    })
    const queryFn = vi.fn(async () => queryFn.mock.calls.length)
    const observer = new QueryObserver(queryClient, {
      queryKey: ['background-refetch-check'],
      queryFn,
      refetchInterval: 1_000,
    })

    const unsubscribe = observer.subscribe(() => {})

    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
    })

    focusManager.setFocused(false)

    await vi.advanceTimersByTimeAsync(1_000)

    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
    })

    unsubscribe()
    queryClient.clear()
  })

  it('keeps explicit live queries polling while the app is unfocused', async () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    })
    const queryFn = vi.fn(async () => queryFn.mock.calls.length)
    const observer = new QueryObserver(queryClient, {
      ...BACKGROUND_REFRESH_QUERY_OPTIONS,
      queryKey: ['background-refetch-check'],
      queryFn,
      refetchInterval: 1_000,
    })

    const unsubscribe = observer.subscribe(() => {})

    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(1)
    })

    focusManager.setFocused(false)

    await vi.advanceTimersByTimeAsync(1_000)

    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2)
    })

    unsubscribe()
    queryClient.clear()
  })

  it('skips mounting cleanly when the root element is unavailable', () => {
    expect(renderApp(null, createAppQueryClient())).toBeNull()
  })
})
