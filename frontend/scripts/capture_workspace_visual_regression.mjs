#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const DEFAULT_VIEWPORT = { width: 1440, height: 2200 }
const ROUTES = [
  { name: 'workspace-overview', route: '/' },
  { name: 'workspace-market', route: '/market/AAPL' },
  { name: 'workspace-backtest', route: '/backtest' },
]

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://127.0.0.1',
    outputDir: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i]
    const next = argv[i + 1]
    if (current === '--base-url' && next) {
      args.baseUrl = next
      i += 1
      continue
    }
    if (current === '--output-dir' && next) {
      args.outputDir = next
      i += 1
    }
  }

  if (!args.outputDir) {
    throw new Error('--output-dir is required')
  }

  return args
}

async function ensureRouteVisible(page, route) {
  const response = await page.goto(route, { waitUntil: 'networkidle' })
  if (!response || !response.ok()) {
    const code = response ? response.status() : 'no-response'
    throw new Error(`failed to load ${route}: ${code}`)
  }
  await page.waitForSelector('#root', { timeout: 30_000 })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  fs.mkdirSync(args.outputDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const manifest = []

  try {
    for (const item of ROUTES) {
      const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT })
      try {
        await ensureRouteVisible(page, `${args.baseUrl.replace(/\/$/, '')}${item.route}`)
        const screenshotPath = path.join(args.outputDir, `${item.name}.png`)
        await page.screenshot({ path: screenshotPath, fullPage: true })
        manifest.push({
          name: item.name,
          route: item.route,
          screenshot: path.basename(screenshotPath),
          captured_at: new Date().toISOString(),
        })
        console.log(`captured ${item.name}`)
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }

  fs.writeFileSync(
    path.join(args.outputDir, 'manifest.json'),
    `${JSON.stringify({ routes: manifest }, null, 2)}\n`,
    'utf-8',
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
