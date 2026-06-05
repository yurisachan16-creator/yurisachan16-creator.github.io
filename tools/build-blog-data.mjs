import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const postsDir = path.join(rootDir, 'source', '_posts')
const outputDir = path.join(rootDir, 'source', 'data')
const outputFile = path.join(outputDir, 'blog-content-index.json')

const routeDefs = [
  {
    id: 'claude-code',
    title: 'Claude Code 源码阅读路线',
    summary: '从整体架构进入，再读 Agent Loop、记忆系统和工程边界。',
    accent: '#49b1f5',
    keywords: ['Claude Code', 'Agent', 'Memory', 'AI CLI', '源码分析'],
    match: function (post) {
      return contains(post, ['Claude Code'])
    }
  },
  {
    id: 'future-master',
    title: '罗大佑《未来的主人翁》系列',
    summary: '按总序、索引和单曲长文推进，重读一张唱片里的时代问题。',
    accent: '#ee9ab3',
    keywords: ['罗大佑', '未来的主人翁', '音乐札记', '专辑考证'],
    match: function (post) {
      return post.url.indexOf('/music/luo-dayou-future-master/') === 0 || contains(post, ['罗大佑', '未来的主人翁'])
    }
  },
  {
    id: 'blog-building',
    title: '博客搭建与 Cloudflare 路线',
    summary: '从 Butterfly 主题体验到 Cloudflare 域名、Pages 和 Worker 动态接口。',
    accent: '#76bea7',
    keywords: ['Hexo', 'Butterfly', 'Cloudflare', '博客搭建', '域名'],
    match: function (post) {
      return contains(post, ['Hexo', 'Butterfly', 'Cloudflare', '博客搭建', '域名'])
    }
  },
  {
    id: 'ai-tools',
    title: 'AI 工具与 Web 搜索路线',
    summary: '聚焦 AI 工具、MCP、搜索和开发工作流里的系统拆解。',
    accent: '#b78bec',
    keywords: ['AI', 'MCP', 'WebSearch', '工具', '架构设计'],
    match: function (post) {
      return contains(post, ['AI', 'MCP', 'WebSearch']) && post.title.indexOf('Claude Code') < 0
    }
  },
  {
    id: 'game-design',
    title: '游戏体验与系统拆解路线',
    summary: '把游戏体验、玩家模型和系统循环拆开看，适合做设计复盘。',
    accent: '#ffb84d',
    keywords: ['游戏', '玩家模型', '系统拆解', '玩法设计'],
    match: function (post) {
      return contains(post, ['游戏', '玩家模型', '玩法设计'])
    }
  }
]

async function main () {
  const files = await walk(postsDir)
  const posts = []

  for (const file of files) {
    if (!file.endsWith('.md')) continue
    const raw = await readFile(file, 'utf8')
    const frontMatter = parseFrontMatter(raw)
    if (!frontMatter || !frontMatter.title) continue

    posts.push(normalizePost(frontMatter, file))
  }

  posts.sort(function (a, b) {
    return compareDateDesc(a.date, b.date) || a.title.localeCompare(b.title, 'zh-CN')
  })

  const routes = routeDefs.map(function (route) {
    const entries = posts
      .filter(route.match)
      .sort(function (a, b) {
        if (route.id === 'future-master') return a.url.localeCompare(b.url)
        return compareDateAsc(a.date, b.date) || a.title.localeCompare(b.title, 'zh-CN')
      })
      .map(function (post, index) {
        return {
          step: index + 1,
          title: post.title,
          url: post.url,
          date: post.date,
          description: post.description,
          tags: post.tags,
          categories: post.categories
        }
      })

    return {
      id: route.id,
      title: route.title,
      summary: route.summary,
      accent: route.accent,
      keywords: route.keywords,
      entries
    }
  }).filter(function (route) {
    return route.entries.length > 0
  })

  const updates = posts.flatMap(function (post) {
    return post.articleHistory.map(function (item) {
      return {
        title: post.title,
        url: post.url,
        version: item.version,
        date: item.date,
        summary: item.summary,
        tags: post.tags,
        categories: post.categories
      }
    })
  }).sort(function (a, b) {
    return compareDateDesc(a.date, b.date) || b.version.localeCompare(a.version)
  })

  const payload = {
    generatedAt: latestContentDate(posts),
    posts,
    routes,
    updates
  }

  await mkdir(outputDir, { recursive: true })
  await writeFile(outputFile, JSON.stringify(payload, null, 2) + '\n', 'utf8')
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

function normalizePost (frontMatter, file) {
  return {
    title: String(frontMatter.title || '').trim(),
    url: normalizeUrl(frontMatter.permalink),
    date: normalizeDate(frontMatter.date),
    updated: normalizeDate(frontMatter.updated || frontMatter.date),
    description: String(frontMatter.description || '').trim(),
    tags: normalizeStringArray(frontMatter.tags),
    categories: normalizeStringArray(frontMatter.categories),
    articleVersion: String(frontMatter.article_version || '').trim(),
    articleHistory: normalizeHistory(frontMatter.article_history),
    source: path.relative(rootDir, file)
  }
}

function normalizeStringArray (value) {
  if (Array.isArray(value)) return value.map(function (item) { return String(item).trim() }).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function normalizeHistory (value) {
  if (!Array.isArray(value)) return []
  return value.map(function (item) {
    if (!item || typeof item !== 'object') return null
    const version = String(item.version || '').trim()
    const date = normalizeDate(item.date)
    const summary = String(item.summary || '').trim()
    if (!version || !date || !summary) return null
    return { version, date, summary }
  }).filter(Boolean)
}

function normalizeUrl (value) {
  const raw = String(value || '').trim()
  if (!raw) return '/'
  if (raw.startsWith('/')) return raw
  return '/' + raw
}

function normalizeDate (value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return raw
}

function compareDateAsc (a, b) {
  return String(a || '').localeCompare(String(b || ''))
}

function compareDateDesc (a, b) {
  return String(b || '').localeCompare(String(a || ''))
}

function latestContentDate (posts) {
  return posts.reduce(function (latest, post) {
    const value = post.updated || post.date || ''
    return value > latest ? value : latest
  }, '')
}

function contains (post, keywords) {
  const haystack = [
    post.title,
    post.description,
    post.url,
    post.tags.join(' '),
    post.categories.join(' ')
  ].join(' ').toLowerCase()
  return keywords.some(function (keyword) {
    return haystack.indexOf(String(keyword).toLowerCase()) >= 0
  })
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
