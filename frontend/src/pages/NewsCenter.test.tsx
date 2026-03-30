import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewsCenterPage from './NewsCenter'

const mockAnalyzeSentiment = vi.fn()
const mockGetNewsFeed = vi.fn()
const mockGetNewsDetail = vi.fn()
const mockGetNewsStats = vi.fn()
const mockGetNewsTask = vi.fn()
const mockRefreshNews = vi.fn()

vi.mock('../api/analysis', () => ({
  analyzeSentiment: (...args: unknown[]) => mockAnalyzeSentiment(...args),
}))

vi.mock('../api/news', () => ({
  getNewsFeed: (...args: unknown[]) => mockGetNewsFeed(...args),
  getNewsDetail: (...args: unknown[]) => mockGetNewsDetail(...args),
  getNewsStats: (...args: unknown[]) => mockGetNewsStats(...args),
  getNewsTask: (...args: unknown[]) => mockGetNewsTask(...args),
  refreshNews: (...args: unknown[]) => mockRefreshNews(...args),
}))

function renderPage(initialEntry = '/news') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <NewsCenterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('NewsCenterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAnalyzeSentiment.mockResolvedValue({ data: null, meta: {} })
    mockGetNewsFeed.mockResolvedValue({ data: [], meta: { page: 1, page_size: 24, total: 0 } })
    mockGetNewsDetail.mockResolvedValue({ data: null, meta: {} })
    mockGetNewsStats.mockResolvedValue({
      data: { total: 0, positive_count: 0, neutral_count: 0, negative_count: 0 },
      meta: {},
    })
    mockGetNewsTask.mockResolvedValue({ data: null, meta: {} })
    mockRefreshNews.mockResolvedValue({ data: null, meta: {} })
  })

  it('hydrates the query input from the URL and uses it for the feed request', async () => {
    renderPage('/news?query=fed')

    const queryInput = screen.getByPlaceholderText('fed / earnings / tesla')
    expect(queryInput).toHaveValue('fed')

    await waitFor(() => {
        expect(mockGetNewsFeed).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'fed',
            page: 1,
          }),
        )
      })
  })

  it('shows a feed error instead of collapsing the page into a generic empty state', async () => {
    mockGetNewsFeed.mockRejectedValue(new Error('feed down'))

    renderPage()

    expect(await screen.findByText(/feed down/i)).toBeInTheDocument()
    expect(screen.queryByText('No data for current filter.')).toBeNull()
  })

  it('loads detail when expanding one news item and supports load more pagination', async () => {
    mockGetNewsFeed
      .mockResolvedValueOnce({
        data: [
          {
            id: 1,
            title: 'Fed holds rates',
            source: 'wire',
            published_at: '2026-03-28T00:00:00Z',
            symbols: ['SPY'],
            categories: ['macro'],
            markets: ['us'],
            sentiment: 0.25,
            importance: 4,
            llm_summary: 'summary page1',
            llm_impact: 'impact page1',
          },
        ],
        meta: { page: 1, page_size: 24, total: 30 },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 2,
            title: 'Second page headline',
            source: 'wire',
            published_at: '2026-03-28T01:00:00Z',
            symbols: ['QQQ'],
            categories: ['macro'],
            markets: ['us'],
            sentiment: -0.1,
            importance: 3,
          },
        ],
        meta: { page: 2, page_size: 24, total: 30 },
      })
    mockGetNewsDetail.mockResolvedValue({
      data: {
        id: 1,
        content: 'full content body',
        llm_summary: 'detail summary',
        llm_impact: 'detail impact',
        categories: ['macro', 'policy'],
        url: 'https://example.com/story',
      },
      meta: {},
    })

    renderPage()

    const firstCard = await screen.findByRole('button', { name: /Fed holds rates/i })
    expect(screen.getByLabelText('importance 4 of 5')).toBeInTheDocument()
    await userEvent.click(firstCard)

    await waitFor(() => {
      expect(mockGetNewsDetail).toHaveBeenCalledWith(1)
    })
    expect(await screen.findByText(/detail summary/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open source link/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /load more/i }))

    await waitFor(() => {
      expect(mockGetNewsFeed).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
    })
    expect(await screen.findByText('Second page headline')).toBeInTheDocument()
  })

  it('tracks the refresh task instead of implying the stream is already updated', async () => {
    mockRefreshNews.mockResolvedValue({
      data: { status: 'queued', task_id: 'news-task-1' },
      meta: { accepted_at: '2026-03-28T00:00:00Z' },
    })
    mockGetNewsTask.mockResolvedValue({
      data: { task_id: 'news-task-1', status: 'completed' },
      meta: { execution_mode: 'celery' },
    })

    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /refresh/i }))

    await waitFor(() => {
      expect(mockGetNewsTask).toHaveBeenCalledWith('news-task-1')
    })
    expect(await screen.findByText(/current stream may still be updating/i)).toBeInTheDocument()
  })

  it('keeps the refresh button locked while the refresh task is still running', async () => {
    mockRefreshNews.mockResolvedValue({
      data: { status: 'queued', task_id: 'news-task-2' },
      meta: { accepted_at: '2026-03-28T00:00:00Z' },
    })
    mockGetNewsTask.mockResolvedValue({
      data: { task_id: 'news-task-2', status: 'running' },
      meta: { execution_mode: 'celery' },
    })

    renderPage()

    const refreshButton = await screen.findByRole('button', { name: /refresh/i })
    await userEvent.click(refreshButton)

    await waitFor(() => {
      expect(mockGetNewsTask).toHaveBeenCalledWith('news-task-2')
      expect(screen.getByRole('button', { name: /refreshing/i })).toBeDisabled()
    })
  })

  it('runs on-demand sentiment analysis from the expanded news detail', async () => {
    mockGetNewsFeed.mockResolvedValue({
      data: [
        {
          id: 7,
          title: 'Nvidia posts stronger than expected guidance',
          source: 'wire',
          published_at: '2026-03-28T00:00:00Z',
          symbols: ['NVDA'],
          categories: ['earnings'],
          markets: ['us'],
          sentiment: 0.4,
          importance: 5,
          llm_summary: 'headline summary',
        },
      ],
      meta: { page: 1, page_size: 24, total: 1 },
    })
    mockGetNewsDetail.mockResolvedValue({
      data: {
        id: 7,
        content: 'Revenue outlook moved higher and datacenter demand remained strong.',
        llm_summary: 'detail summary',
        llm_impact: 'detail impact',
        categories: ['earnings'],
      },
      meta: {},
    })
    mockAnalyzeSentiment.mockResolvedValue({
      data: {
        sentiment_score: 0.78,
        sentiment_label: 'positive',
        context_symbols: ['NVDA'],
        llm_analysis: {
          summary: 'The update is strongly constructive for AI infrastructure demand.',
          key_factors: ['guidance beat'],
        },
      },
      meta: { model: 'gpt-5.3-codex' },
    })

    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /Nvidia posts stronger than expected guidance/i }))
    await screen.findByText(/detail summary/i)
    await userEvent.click(screen.getByRole('button', { name: /Analyze sentiment/i }))

    await waitFor(() => {
      expect(mockAnalyzeSentiment).toHaveBeenCalledWith({
        text: 'Nvidia posts stronger than expected guidance\n\nRevenue outlook moved higher and datacenter demand remained strong.',
        context_symbols: ['NVDA'],
      })
    })
    expect(await screen.findByText(/The update is strongly constructive/i)).toBeInTheDocument()
    expect(screen.getByText(/positive 0.780/i)).toBeInTheDocument()
    expect(screen.getByText('guidance beat')).toBeInTheDocument()
  })
})
