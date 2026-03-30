const DEFAULT_PLACEHOLDER = '-'

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
const HTML_BREAK_RE = /<\s*(?:br|\/p|\/div|\/li|\/blockquote|\/h[1-6])\s*\/?>/gi
const HTML_OPEN_BLOCK_RE = /<\s*(?:p|div|li|blockquote|h[1-6])[^>]*>/gi
const HTML_TAG_RE = /<[^>]+>/g
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi
const URL_RE = /https?:\/\/[^\s)]+/gi
const REDDIT_TRAILER_RE = /\bsubmitted by\b[\s\S]*$/i
const MULTI_SPACE_RE = /[ \t\f\v]+/g
const SURROUNDED_NEWLINE_RE = /\s*\n\s*/g
const MULTI_NEWLINE_RE = /\n{3,}/g

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

let entityDecoder: HTMLTextAreaElement | null = null

function decodeHtmlEntities(value: string): string {
  if (typeof document !== 'undefined') {
    entityDecoder ??= document.createElement('textarea')
    entityDecoder.innerHTML = value
    return entityDecoder.value
  }

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

function normalizeRemoteText(value: unknown): string | null {
  if (value === null || value === undefined) return null

  let text = typeof value === 'string' ? value : String(value)
  text = text.replace(/\r\n?/g, '\n')
  text = text.replace(HTML_COMMENT_RE, ' ')
  text = text.replace(HTML_BREAK_RE, '\n')
  text = text.replace(HTML_OPEN_BLOCK_RE, '\n')
  text = text.replace(MARKDOWN_LINK_RE, '$1')
  text = text.replace(HTML_TAG_RE, ' ')
  text = decodeHtmlEntities(text)
  text = text.replace(URL_RE, ' ')
  text = text.replace(REDDIT_TRAILER_RE, ' ')
  text = text.replace(MULTI_SPACE_RE, ' ')
  text = text.replace(SURROUNDED_NEWLINE_RE, '\n')
  text = text.replace(MULTI_NEWLINE_RE, '\n\n')
  text = text.trim()

  return text.length > 0 ? text : null
}

export function displayPlainText(value: unknown, placeholder = DEFAULT_PLACEHOLDER): string {
  return normalizeRemoteText(value) ?? placeholder
}

export function displayPreviewText(value: unknown, maxLength = 180, placeholder = DEFAULT_PLACEHOLDER): string {
  const text = normalizeRemoteText(value)
  if (!text) return placeholder
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function formatDegradedReason(value: string | null | undefined): string {
  if (!value) return 'LLM online'
  if (value === 'llm_disabled') return 'LLM not configured, heuristic fallback active.'
  if (value.startsWith('llm_error:')) {
    return `LLM unavailable (${value.slice('llm_error:'.length)}), heuristic fallback active.`
  }
  return value.replaceAll('_', ' ')
}
