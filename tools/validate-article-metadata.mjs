import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const postsDir = path.join(rootDir, 'source', '_posts')
const semverPattern = /^\d+\.\d+\.\d+$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/

async function main () {
  const files = (await walk(postsDir)).filter(function (file) {
    return file.endsWith('.md')
  })
  const failures = []

  for (const file of files) {
    const raw = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '')
    const frontMatter = parseFrontMatter(raw)
    const rel = path.relative(rootDir, file)
    failures.push(...validatePost(frontMatter, rel))
  }

  if (failures.length) {
    console.error('[article-metadata] failed')
    failures.forEach(function (failure) {
      console.error('- ' + failure)
    })
    process.exitCode = 1
    return
  }

  console.log('[article-metadata] ok. checked ' + files.length + ' posts.')
}

async function walk (dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

function validatePost (frontMatter, rel) {
  const failures = []
  if (!frontMatter) return [rel + ': missing front-matter']
  if (frontMatter.draft === true || frontMatter.published === false) return failures

  requireField(frontMatter, rel, 'title', failures)
  requireField(frontMatter, rel, 'date', failures)
  requireField(frontMatter, rel, 'permalink', failures)

  const version = String(frontMatter.article_version || '').trim()
  if (!version) {
    failures.push(rel + ': missing article_version')
  } else if (!semverPattern.test(version)) {
    failures.push(rel + ': article_version must be SemVer like 1.0.0')
  }

  const history = Array.isArray(frontMatter.article_history) ? frontMatter.article_history : []
  if (!history.length) {
    failures.push(rel + ': article_history must contain at least one entry')
  }

  let hasCurrentVersion = false
  history.forEach(function (item, index) {
    const prefix = rel + ': article_history[' + index + ']'
    if (!item || typeof item !== 'object') {
      failures.push(prefix + ' must be an object')
      return
    }

    const itemVersion = String(item.version || '').trim()
    const itemDate = normalizeDate(item.date)
    const summary = String(item.summary || '').trim()

    if (!semverPattern.test(itemVersion)) failures.push(prefix + '.version must be SemVer like 1.0.0')
    if (!datePattern.test(itemDate)) failures.push(prefix + '.date must be YYYY-MM-DD')
    if (!summary) failures.push(prefix + '.summary is required')
    if (itemVersion === version) hasCurrentVersion = true
  })

  if (version && history.length && !hasCurrentVersion) {
    failures.push(rel + ': article_history must include current article_version ' + version)
  }

  return failures
}

function requireField (frontMatter, rel, key, failures) {
  if (!String(frontMatter[key] || '').trim()) failures.push(rel + ': missing ' + key)
}

function parseFrontMatter (raw) {
  if (!raw.startsWith('---\n')) return null
  const end = raw.indexOf('\n---', 4)
  if (end < 0) return null
  return parseYamlBlock(raw.slice(4, end))
}

function parseYamlBlock (block) {
  const lines = block.split(/\r?\n/)
  const result = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const top = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/)
    if (!top) {
      i += 1
      continue
    }

    const key = top[1]
    const value = top[2] || ''
    if (value.trim()) {
      result[key] = parseScalar(value)
      i += 1
      continue
    }

    const list = []
    i += 1
    while (i < lines.length && /^  - /.test(lines[i])) {
      const itemLine = lines[i].replace(/^  - /, '')
      const objectStart = itemLine.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
      if (objectStart) {
        const item = {}
        item[objectStart[1]] = parseScalar(objectStart[2])
        i += 1
        while (i < lines.length && /^    [A-Za-z0-9_]+:/.test(lines[i])) {
          const child = lines[i].trim().match(/^([A-Za-z0-9_]+):\s*(.*)$/)
          if (child) item[child[1]] = parseScalar(child[2])
          i += 1
        }
        list.push(item)
      } else {
        list.push(parseScalar(itemLine))
        i += 1
      }
    }

    result[key] = list
  }

  return result
}

function parseScalar (value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed
}

function normalizeDate (value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return raw
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
