import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

import { resetFrontendPerformanceMetrics } from '../utils/runtimePerformance'

afterEach(() => {
  resetFrontendPerformanceMetrics()
})
