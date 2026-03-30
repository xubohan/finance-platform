import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider, type DefaultOptions, type QueryClientConfig } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import './styles.css'

export const APP_QUERY_DEFAULT_OPTIONS: DefaultOptions = {
  queries: {
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchIntervalInBackground: false,
  },
  mutations: {
    retry: 0,
  },
}

export function createAppQueryClient(config: QueryClientConfig = {}) {
  const defaultOptions = config.defaultOptions ?? {}

  return new QueryClient({
    ...config,
    defaultOptions: {
      ...APP_QUERY_DEFAULT_OPTIONS,
      ...defaultOptions,
      queries: {
        ...APP_QUERY_DEFAULT_OPTIONS.queries,
        ...defaultOptions.queries,
      },
      mutations: {
        ...APP_QUERY_DEFAULT_OPTIONS.mutations,
        ...defaultOptions.mutations,
      },
    },
  })
}

export function renderApp(rootElement: HTMLElement | null, queryClient = createAppQueryClient()) {
  if (!rootElement) return null

  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>,
  )

  return root
}

renderApp(document.getElementById('root'))
