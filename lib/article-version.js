function toTrimmedString (value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeHistoryEntry (entry) {
  if (!entry || typeof entry !== 'object') return null

  const version = toTrimmedString(entry.version)
  const date = normalizeDate(entry.date)
  const summary = toTrimmedString(entry.summary)

  if (!version || !date || !summary) return null

  return { version, date, summary }
}

function normalizeDate (value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const raw = value == null ? '' : String(value).trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10)

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }

  return raw
}

function normalizeArticleVersionMeta (page) {
  const currentVersion = toTrimmedString(page && page.article_version)
  const history = Array.isArray(page && page.article_history)
    ? page.article_history.map(normalizeHistoryEntry).filter(Boolean)
    : []

  if (!currentVersion && history.length === 0) return null

  return {
    currentVersion: currentVersion || history[0].version,
    history
  }
}

module.exports = {
  normalizeArticleVersionMeta
}
