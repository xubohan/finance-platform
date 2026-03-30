import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps, context) {
        if (context.hostType === 'html') {
          return deps.filter((dep) =>
            !dep.includes('workspace-chart') &&
            !dep.includes('workspace-backtest') &&
            !dep.includes('vendor-charts'),
          )
        }
        return deps
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('lightweight-charts')) {
            return 'vendor-charts'
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom') || id.includes('node_modules/scheduler')) {
            return 'vendor-react'
          }
          if (id.includes('/src/components/market/ChartPanel.tsx') || id.includes('/src/components/chart/')) {
            return 'workspace-chart'
          }
          if (id.includes('/src/components/market/BacktestPanel.tsx') || id.includes('/src/components/backtest/')) {
            return 'workspace-backtest'
          }
          return undefined
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
})
