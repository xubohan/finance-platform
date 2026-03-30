import { describe, expect, it } from 'vitest'

import { displayPlainText, displayPreviewText, formatDegradedReason } from './text'

describe('text utils', () => {
  it('strips markup, urls, and reddit footer noise from remote text', () => {
    const raw = `
      <!-- SC_OFF --><div class="md"><p>Saw this on Blossom &amp; thought this matters.</p>
      <p>https://example.com/path?q=1</p></div>
      submitted by /u/test_user [link] [comments]
    `

    expect(displayPlainText(raw)).toBe('Saw this on Blossom & thought this matters.')
  })

  it('builds short previews from cleaned text', () => {
    const raw = '<p>Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.</p>'

    expect(displayPreviewText(raw, 24)).toBe('Alpha beta gamma delta…')
  })

  it('formats degraded reasons for operator-facing UI', () => {
    expect(formatDegradedReason('llm_disabled')).toBe('LLM not configured, heuristic fallback active.')
    expect(formatDegradedReason('llm_error:TimeoutError')).toBe('LLM unavailable (TimeoutError), heuristic fallback active.')
  })
})
