#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://127.0.0.1',
    outputDir: '',
    baselinePath: '',
    writeBaselinePath: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    const next = argv[i + 1]
    if (current === '--base-url' && next) {
      args.baseUrl = next
      i += 1
    } else if (current === '--output-dir' && next) {
      args.outputDir = next
      i += 1
    } else if (current === '--baseline' && next) {
      args.baselinePath = next
      i += 1
    } else if (current === '--write-baseline' && next) {
      args.writeBaselinePath = next
      i += 1
    }
  }

  if (!args.outputDir) {
    throw new Error('--output-dir is required')
  }
  return args
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function buildFixtures() {
  const isoDay = (base, offset) => {
    const next = new Date(`${base}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + offset)
    return next.toISOString()
  }

  return {
    health: { status: 'ok', research_apis: false, ai_api: false },
    observability: {
      data: {
        uptime_sec: 3600,
        http: {
          total_requests: 42,
          slow_request_threshold_ms: 1500,
          status_buckets: { '2xx': 40, '4xx': 1, '5xx': 1 },
          status_totals: { '200': 40, '404': 1, '502': 1 },
          routes: [
            {
              method: 'GET',
              path: '/api/v1/market/{symbol}/summary',
              total: 12,
              avg_duration_ms: 210,
              max_duration_ms: 420,
              last_duration_ms: 190,
              slow_requests: 0,
              slow_rate_pct: 0,
              last_status: 200,
              last_seen_at: '2026-03-14T00:00:00+00:00',
              status_breakdown: { '200': 12 },
            },
          ],
          failing_routes: [
            {
              method: 'GET',
              path: '/api/v1/market/{symbol}/quote',
              status_code: 502,
              count: 1,
              last_seen_at: '2026-03-14T00:00:00+00:00',
            },
          ],
          slow_routes: [],
        },
        market: {
          quotes: {
            crypto: { live_hit_rate_pct: 85, fallback_rate_pct: 15 },
            stock: { local_hit_rate_pct: 70, sync_hit_rate_pct: 20 },
          },
          sync: { success_rate_pct: 100 },
          movers: {
            stock: { success_rate_pct: 100 },
            crypto: { success_rate_pct: 100 },
          },
        },
        counters: {
          'market.quote.crypto.live_success': 6,
          'market.quote.stock.local_success': 8,
          'market.sync.success': 2,
        },
      },
      meta: { generated_at: '2026-03-14T00:00:00+00:00' },
    },
    cacheMaintenance: {
      data: {
        market_snapshot_daily: {
          retention_days: 45,
          cutoff_date: '2026-01-29',
          total_rows: 1200,
          purgeable_rows: 40,
          oldest_trade_date: '2026-01-01',
          newest_trade_date: '2026-03-14',
        },
        backtest_cache: {
          total_rows: 32,
          expired_rows: 3,
          oldest_created_at: '2026-03-01T00:00:00+00:00',
          newest_created_at: '2026-03-14T00:00:00+00:00',
          oldest_expires_at: '2026-03-13T00:00:00+00:00',
          newest_expires_at: '2026-03-14T01:00:00+00:00',
        },
      },
      meta: { generated_at: '2026-03-14T00:00:00+00:00', snapshot_retention_days: 45 },
    },
    stockMovers: {
      data: [
        { symbol: 'NVDA', change_pct: 3.6, latest: 972.4 },
        { symbol: 'AAPL', change_pct: 2.1, latest: 202.3 },
      ],
      meta: { source: 'cache', stale: false, as_of: '2026-03-14T00:00:00+00:00', cache_age_sec: 45 },
    },
    cryptoMovers: {
      data: [
        { symbol: 'BTC', change_pct: 4.2, latest: 71234.5 },
        { symbol: 'ETH', change_pct: 3.1, latest: 3890.2 },
      ],
      meta: { source: 'live', stale: false, as_of: null, cache_age_sec: null },
    },
    summary: {
      data: {
        symbol: 'AAPL',
        asset_type: 'stock',
        quote: {
          symbol: 'AAPL',
          asset_type: 'stock',
          price: 203.55,
          change_pct_24h: 1.82,
          as_of: '2026-03-14T00:00:00+00:00',
        },
        history_status: {
          symbol: 'AAPL',
          asset_type: 'stock',
          local_rows: 252,
          local_start: '2025-03-14T00:00:00+00:00',
          local_end: '2026-03-14T00:00:00+00:00',
          has_data: true,
        },
      },
      meta: {
        quote: {
          source: 'local',
          fetch_source: 'database',
          as_of: '2026-03-14T00:00:00+00:00',
        },
        quote_error: null,
      },
    },
    kline: {
      data: Array.from({ length: 60 }, (_, index) => {
        const open = 170 + index * 0.8
        return {
          time: isoDay('2026-01-01', index),
          open,
          high: open + 3,
          low: open - 2,
          close: open + 1.5,
          volume: 1000000 + index * 5000,
        }
      }),
      meta: {
        source: 'local',
        fetch_source: 'database',
        as_of: '2026-03-14T00:00:00+00:00',
      },
    },
    backtest: {
      data: {
        equity_curve: Array.from({ length: 20 }, (_, index) => ({
          date: isoDay('2026-02-01', index).slice(0, 10),
          value: 100000 + index * 1250,
        })),
        trades: Array.from({ length: 12 }, (_, index) => ({
          date: isoDay('2026-02-01', index).slice(0, 10),
          symbol: 'AAPL',
          action: index % 2 === 0 ? 'buy' : 'sell',
          price: 180 + index,
          shares: 1.25,
          commission: 0.5,
          pnl: index * 4,
        })),
        metrics: {
          total_return: 11.2,
          annual_return: 18.3,
          sharpe_ratio: 1.44,
          max_drawdown: 6.1,
          win_rate: 58.3,
          trade_count: 6,
        },
      },
      meta: {
        storage_source: 'local',
        coverage_complete: true,
        as_of: '2026-03-14T00:00:00+00:00',
      },
    },
  }
}

async function routeApi(page, fixtures) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    const method = route.request().method()

    const json = (body) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (pathname === '/api/v1/health') return json(fixtures.health)
    if (pathname === '/api/v1/system/observability') return json(fixtures.observability)
    if (pathname === '/api/v1/system/cache-maintenance') return json(fixtures.cacheMaintenance)
    if (pathname === '/api/v1/market/top-movers') {
      return json(url.searchParams.get('type') === 'crypto' ? fixtures.cryptoMovers : fixtures.stockMovers)
    }
    if (pathname === '/api/v1/market/AAPL/summary') return json(fixtures.summary)
    if (pathname === '/api/v1/market/AAPL/kline') return json(fixtures.kline)
    if (pathname === '/api/v1/market/search') return json({ data: [], meta: {} })
    if (pathname === '/api/v1/backtest/run' && method === 'POST') return json(fixtures.backtest)

    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'mock-not-found' }),
    })
  })
}

function buildManifest(sections, viewport) {
  return {
    generated_at: new Date().toISOString(),
    viewport,
    sections,
  }
}

function compareWithBaseline(manifest, baseline) {
  const changed = []
  for (const [name, info] of Object.entries(manifest.sections)) {
    const base = baseline.sections?.[name]
    if (!base) {
      changed.push({ name, reason: 'missing_baseline' })
      continue
    }
    if (base.sha256 !== info.sha256 || base.width !== info.width || base.height !== info.height) {
      changed.push({
        name,
        reason: 'hash_mismatch',
        baseline_sha256: base.sha256,
        current_sha256: info.sha256,
      })
    }
  }
  return {
    status: changed.length === 0 ? 'pass' : 'changed',
    changed_sections: changed,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureDir(args.outputDir)
  const fixtures = buildFixtures()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 2200 } })

  await routeApi(page, fixtures)
  await page.goto(`${args.baseUrl}/market`, { waitUntil: 'networkidle' })
  await page.locator('#workspace-backtest').waitFor({ state: 'visible', timeout: 60000 })
  await page.getByRole('button', { name: '运行当前回测' }).waitFor({ state: 'visible', timeout: 60000 })
  await page.getByRole('button', { name: '运行当前回测' }).click()
  await page.getByText('成交记录第 1 / 2 页，共 12 笔').waitFor()

  const sectionIds = ['workspace-overview', 'workspace-chart', 'workspace-backtest']
  const sections = {}

  for (const sectionId of sectionIds) {
    const locator = page.locator(`#${sectionId}`)
    await locator.scrollIntoViewIfNeeded()
    const image = await locator.screenshot({ animations: 'disabled' })
    const fileName = `${sectionId}.png`
    const filePath = path.join(args.outputDir, fileName)
    fs.writeFileSync(filePath, image)
    const box = await locator.boundingBox()
    sections[sectionId] = {
      file: fileName,
      sha256: sha256(image),
      width: box ? Math.round(box.width) : null,
      height: box ? Math.round(box.height) : null,
    }
  }

  const manifest = buildManifest(sections, { width: 1440, height: 2200 })
  const manifestPath = path.join(args.outputDir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  let comparison = { status: 'no-baseline', changed_sections: [] }
  if (args.baselinePath && fs.existsSync(args.baselinePath)) {
    const baseline = JSON.parse(fs.readFileSync(args.baselinePath, 'utf8'))
    comparison = compareWithBaseline(manifest, baseline)
  }
  const comparisonPath = path.join(args.outputDir, 'comparison.json')
  fs.writeFileSync(comparisonPath, JSON.stringify(comparison, null, 2) + '\n', 'utf8')

  if (args.writeBaselinePath) {
    ensureDir(path.dirname(args.writeBaselinePath))
    fs.writeFileSync(args.writeBaselinePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  }

  console.log(JSON.stringify({
    manifest_path: manifestPath,
    comparison_path: comparisonPath,
    status: comparison.status,
    changed_sections: comparison.changed_sections,
  }, null, 2))

  await browser.close()

  if (comparison.status === 'changed') {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
