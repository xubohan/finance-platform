import { useSyncExternalStore } from 'react'

import {
  getFrontendPerformanceSnapshot,
  subscribeFrontendPerformance,
} from '../utils/runtimePerformance'

export function useFrontendPerformance() {
  return useSyncExternalStore(
    subscribeFrontendPerformance,
    getFrontendPerformanceSnapshot,
    getFrontendPerformanceSnapshot,
  )
}
