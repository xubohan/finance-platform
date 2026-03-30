import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EventsPage from './EventsCenter'
import { monthEnd, monthStart, toDateInputLocal } from '../utils/time'

const mockAnalyzeEventImpact = vi.fn()
const mockBackfillEventImpact = vi.fn()
const mockGetAnalysisTask = vi.fn()
const mockGetEventCalendar = vi.fn()
const mockGetEventDetail = vi.fn()
const mockGetEventHistory = vi.fn()
const mockGetEventImpact = vi.fn()
const mockGetEventTask = vi.fn()
const mockRefreshEvents = vi.fn()
const mockSearchEvents = vi.fn()

vi.mock('../api/analysis', () => ({
  analyzeEventImpact: (...args: unknown[]) => mockAnalyzeEventImpact(...args),
  getAnalysisTask: (...args: unknown[]) => mockGetAnalysisTask(...args),
}))

vi.mock('../api/events', () => ({
  backfillEventImpact: (...args: unknown[]) => mockBackfillEventImpact(...args),
  getEventCalendar: (...args: unknown[]) => mockGetEventCalendar(...args),
  getEventDetail: (...args: unknown[]) => mockGetEventDetail(...args),
  getEventHistory: (...args: unknown[]) => mockGetEventHistory(...args),
  getEventImpact: (...args: unknown[]) => mockGetEventImpact(...args),
  getEventTask: (...args: unknown[]) => mockGetEventTask(...args),
  refreshEvents: (...args: unknown[]) => mockRefreshEvents(...args),
  searchEvents: (...args: unknown[]) => mockSearchEvents(...args),
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <EventsPage />
    </QueryClientProvider>,
  )
}

describe('EventsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEventCalendar.mockResolvedValue({ data: [], meta: { count: 0 } })
    mockGetEventDetail.mockResolvedValue({ data: null, meta: {} })
    mockGetEventHistory.mockResolvedValue({ data: [], meta: { count: 0 } })
    mockGetEventImpact.mockResolvedValue({ data: null, meta: {} })
    mockGetEventTask.mockResolvedValue({ data: { task_id: 'events-refresh-1', status: 'completed' }, meta: {} })
    mockRefreshEvents.mockResolvedValue({ data: { status: 'queued', task_id: 'events-refresh-1' }, meta: {} })
    mockBackfillEventImpact.mockResolvedValue({ data: { status: 'accepted', inserted_records: 0 }, meta: {} })
    mockAnalyzeEventImpact.mockResolvedValue({ data: null, meta: {} })
    mockGetAnalysisTask.mockResolvedValue({ status: 'completed' })
    mockSearchEvents.mockResolvedValue({ data: [], meta: { count: 0 } })
  })

  it('requests the selected calendar month and updates the range when switching months', async () => {
    const user = userEvent.setup()
    const now = new Date()
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    renderPage()

    await waitFor(() => {
      expect(mockGetEventCalendar).toHaveBeenCalledWith({
        start: monthStart(now),
        end: monthEnd(now),
      })
    })

    await user.click(screen.getByRole('button', { name: '下一月' }))

    await waitFor(() => {
      expect(mockGetEventCalendar).toHaveBeenLastCalledWith({
        start: monthStart(nextMonth),
        end: monthEnd(nextMonth),
      })
    })
  })

  it('sanitizes raw event descriptions before rendering the detail pane', async () => {
    const user = userEvent.setup()
    const today = toDateInputLocal(new Date())

    mockGetEventCalendar.mockResolvedValue({
      data: [
        {
          id: 7,
          title: 'Raw feed item',
          event_type: 'policy',
          event_date: today,
          symbols: ['SPY'],
        },
      ],
      meta: { count: 1 },
    })
    mockGetEventDetail.mockResolvedValue({
      data: {
        id: 7,
        title: 'Raw feed item',
        event_type: 'policy',
        event_date: today,
        description: '<!-- SC_OFF --><div class="md"><p>Saw this on Blossom &amp; thought this matters.</p><p>https://example.com/path</p></div> submitted by /u/test_user',
        source: 'reddit',
      },
      meta: {},
    })

    renderPage()

    await user.click(await screen.findByRole('button', { name: /Raw feed item/i }))

    await waitFor(() => {
      expect(mockGetEventDetail).toHaveBeenCalledWith(7)
    })
    expect(screen.getByText(/Open the queue to inspect one event at a time, then switch to the inspector to read impact or run analysis\./i)).toBeInTheDocument()
    expect(await screen.findByText(/Saw this on Blossom & thought this matters\./i)).toBeInTheDocument()
    expect(screen.queryByText(/SC_OFF/i)).toBeNull()
    expect(screen.queryByText(/https:\/\/example\.com/i)).toBeNull()
  })

  it('shows calendar counts only for days with events so empty cells do not render zero-event labels', async () => {
    const today = toDateInputLocal(new Date())

    mockGetEventCalendar.mockResolvedValue({
      data: [
        {
          id: 9,
          title: 'Fed minutes',
          event_type: 'macro',
          event_date: today,
          symbols: ['SPY'],
        },
      ],
      meta: { count: 1 },
    })

    renderPage()

    expect(await screen.findByText('1 evt')).toBeInTheDocument()
    expect(screen.queryByText('0 evt')).toBeNull()
  })

  it('keeps the analysis task in a running state with a visible task id instead of forcing a client timeout', async () => {
    mockAnalyzeEventImpact.mockResolvedValue({ data: { task_id: 'task-running' }, meta: {} })
    mockGetAnalysisTask.mockResolvedValue({ status: 'pending', task_id: 'task-running' })

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    fireEvent.change(screen.getByPlaceholderText('paste event or news text'), { target: { value: 'Fed surprise hike' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Analyze' })[1])

    await waitFor(() => {
      expect(screen.getByText('Analysis is running.')).toBeInTheDocument()
    })
    expect(screen.getByText(/task_id task-running/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Analyzing' })[0]).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Retry analysis' })).toBeNull()
  })

  it('shows history request errors instead of masking them as an empty history state', async () => {
    mockGetEventHistory.mockRejectedValue(new Error('history down'))

    renderPage()

    expect(await screen.findByText(/history down/i)).toBeInTheDocument()
    expect(screen.queryByText('No recent history events.')).toBeNull()
  })

  it('can trigger an event refresh task and surface the queued state', async () => {
    const user = userEvent.setup()

    renderPage()

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => {
      expect(mockRefreshEvents).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText(/refresh completed/i)).toBeInTheDocument()
  })

  it('locks the refresh button while the refresh task is still running', async () => {
    const user = userEvent.setup()
    mockGetEventTask.mockResolvedValue({ data: { task_id: 'events-refresh-2', status: 'running' }, meta: {} })
    mockRefreshEvents.mockResolvedValue({ data: { status: 'queued', task_id: 'events-refresh-2' }, meta: {} })

    renderPage()

    await user.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => {
      expect(mockGetEventTask).toHaveBeenCalledWith('events-refresh-2')
      expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled()
    })
  })
})
