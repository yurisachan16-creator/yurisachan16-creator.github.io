import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeApiBase, parseArgs, runSmoke } from '../../tools/smoke-dynamic-api.mjs'

function jsonResponse (body, init) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...(init && init.headers) },
    status: init && init.status
  })
}

describe('dynamic API smoke helper', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('parses options and normalizes API base', () => {
    expect(normalizeApiBase('https://api.example.test/api/v1///')).toBe('https://api.example.test/api/v1')
    expect(parseArgs(['--api-base', 'https://api.example.test/api/v1', '--admin-token', 'token', '--allow-writes'])).toEqual({
      apiBase: 'https://api.example.test/api/v1',
      adminToken: 'token',
      allowWrites: true
    })
  })

  it('checks admin boundaries and skips public reads by default', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers || {} })
      if (options.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: { 'Access-Control-Allow-Origin': 'https://yurisa.top' }
        })
      }
      if (String(url).includes('/admin/comments') && !options.headers.Authorization) {
        return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
      }
      if (String(url).includes('/admin/comments')) {
        return jsonResponse({ comments: [], nextCursor: null }, { status: 200 })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    }))

    const checks = await runSmoke({
      apiBase: 'https://api.example.test/api/v1/',
      origin: 'https://yurisa.top',
      adminToken: 'admin-token',
      slug: '2026/04/02/claude-code-architecture',
      allowWrites: false
    })

    expect(checks.map((check) => check.name)).toEqual([
      'cors-preflight',
      'admin-auth-boundary',
      'admin-list-authorized',
      'public-post-read'
    ])
    expect(checks.find((check) => check.name === 'public-post-read').skipped).toBe(true)
    expect(calls.some((call) => call.url.includes('/posts/'))).toBe(false)
  })

  it('checks public endpoints only when writes are explicitly allowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (options.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: { 'Access-Control-Allow-Origin': 'https://yurisa.top' }
        })
      }
      if (String(url).includes('/admin/comments') && !options.headers.Authorization) {
        return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
      }
      if (String(url).includes('/admin/comments')) {
        return jsonResponse({ comments: [], nextCursor: null }, { status: 200 })
      }
      if (String(url).includes('/metrics')) {
        return jsonResponse({ views: 1, likes: 0, comments: 0, likedByMe: false }, { status: 200 })
      }
      if (String(url).includes('/comments')) {
        return jsonResponse({ comments: [], nextCursor: null }, { status: 200 })
      }
      return jsonResponse({ error: 'unexpected' }, { status: 500 })
    }))

    const checks = await runSmoke({
      apiBase: 'https://api.example.test/api/v1',
      origin: 'https://yurisa.top',
      adminToken: 'admin-token',
      slug: '2026/04/02/claude-code-architecture',
      allowWrites: true
    })

    expect(checks.map((check) => check.name)).toEqual([
      'cors-preflight',
      'admin-auth-boundary',
      'admin-list-authorized',
      'public-metrics',
      'public-comments'
    ])
    expect(checks.every((check) => check.ok)).toBe(true)
  })
})
