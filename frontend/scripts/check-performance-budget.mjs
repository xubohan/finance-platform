#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const distDir = path.join(rootDir, 'dist')
const budgetPath = path.join(rootDir, 'performance-budget.json')
const indexHtmlPath = path.join(distDir, 'index.html')
const assetsDir = path.join(distDir, 'assets')

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!fs.existsSync(indexHtmlPath)) {
  fail('dist/index.html 不存在，请先运行 npm run build')
}

if (!fs.existsSync(budgetPath)) {
  fail('performance-budget.json 不存在')
}

const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'))
const html = fs.readFileSync(indexHtmlPath, 'utf8')
const assetMatches = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1])
const uniqueAssets = [...new Set(assetMatches)]

function assetStats(relativeAssetPath) {
  const assetPath = path.join(distDir, relativeAssetPath.replace(/^\//, ''))
  const bytes = fs.readFileSync(assetPath)
  return {
    rawBytes: bytes.length,
    gzipBytes: zlib.gzipSync(bytes).length,
  }
}

const initialJsAssets = uniqueAssets.filter((item) => item.endsWith('.js'))
const initialCssAssets = uniqueAssets.filter((item) => item.endsWith('.css'))

const totals = {
  initialJsRaw: initialJsAssets.reduce((sum, item) => sum + assetStats(item).rawBytes, 0),
  initialJsGzip: initialJsAssets.reduce((sum, item) => sum + assetStats(item).gzipBytes, 0),
  initialCssRaw: initialCssAssets.reduce((sum, item) => sum + assetStats(item).rawBytes, 0),
  initialCssGzip: initialCssAssets.reduce((sum, item) => sum + assetStats(item).gzipBytes, 0),
}

const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : []
const chunkResults = {}

for (const [chunkName, chunkBudget] of Object.entries(budget.chunk_budgets ?? {})) {
  const fileName = assetFiles.find((item) => item.startsWith(`${chunkName}-`) && item.endsWith('.js'))
  if (!fileName) {
    fail(`未找到 chunk ${chunkName}，当前 assets: ${assetFiles.join(', ')}`)
  }
  chunkResults[chunkName] = assetStats(`/assets/${fileName}`)
  chunkResults[chunkName].fileName = fileName
  chunkResults[chunkName].budget = chunkBudget
}

const failures = []

function checkBudget(label, actual, limit) {
  if (actual > limit) {
    failures.push(`${label} 超出预算: actual=${actual} limit=${limit}`)
  }
}

checkBudget('initial.js.raw', totals.initialJsRaw, budget.initial.js_raw_bytes)
checkBudget('initial.js.gzip', totals.initialJsGzip, budget.initial.js_gzip_bytes)
checkBudget('initial.css.raw', totals.initialCssRaw, budget.initial.css_raw_bytes)
checkBudget('initial.css.gzip', totals.initialCssGzip, budget.initial.css_gzip_bytes)

for (const [chunkName, result] of Object.entries(chunkResults)) {
  checkBudget(`${chunkName}.raw`, result.rawBytes, result.budget.raw_bytes)
  checkBudget(`${chunkName}.gzip`, result.gzipBytes, result.budget.gzip_bytes)
}

console.log('Performance Budget Summary')
console.log(`  initial.js.raw=${totals.initialJsRaw}`)
console.log(`  initial.js.gzip=${totals.initialJsGzip}`)
console.log(`  initial.css.raw=${totals.initialCssRaw}`)
console.log(`  initial.css.gzip=${totals.initialCssGzip}`)
for (const [chunkName, result] of Object.entries(chunkResults)) {
  console.log(`  ${chunkName}.file=${result.fileName}`)
  console.log(`  ${chunkName}.raw=${result.rawBytes}`)
  console.log(`  ${chunkName}.gzip=${result.gzipBytes}`)
}

if (failures.length > 0) {
  console.error('Performance budget failed:')
  for (const item of failures) {
    console.error(`  - ${item}`)
  }
  process.exit(1)
}

console.log('Performance budget passed.')
