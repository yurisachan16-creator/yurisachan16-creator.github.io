interface Env {
  DB: D1Database
  RATE_LIMIT: KVNamespace
  CORS_ORIGIN?: string
  TURNSTILE_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GITHUB_OAUTH_REDIRECT_URI?: string
  JWT_SECRET?: string
  ADMIN_JWT_SECRET?: string
}

type JsonRecord = Record<string, unknown>

const API_PREFIX = '/api/v1'
const COMMENT_MIN_LEN = 2
const COMMENT_MAX_LEN = 1200
const NICKNAME_MAX_LEN = 40
const EMAIL_MAX_LEN = 80
const COMMENT_PAGE_SIZE = 20

export default {
  async fetch (request: Request, env: Env): Promise<Response> {
    const cors = buildCorsHeaders(request, env)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const url = new URL(request.url)
    if (!url.pathname.startsWith(API_PREFIX)) {
      return json({ error: 'Not Found' }, 404, cors)
    }

    const path = normalizePath(url.pathname)

    try {
      const metricsMatch = path.match(/^\/posts\/([^/]+)\/metrics$/)
      if (request.method === 'GET' && metricsMatch) {
        return handleGetMetrics(decodeURIComponent(metricsMatch[1]), request, env, cors)
      }

      const viewMatch = path.match(/^\/posts\/([^/]+)\/view$/)
      if (request.method === 'POST' && viewMatch) {
        return handleRecordView(decodeURIComponent(viewMatch[1]), request, env, cors)
      }

      const likeMatch = path.match(/^\/posts\/([^/]+)\/like$/)
      if (request.method === 'POST' && likeMatch) {
        return handleLike(decodeURIComponent(likeMatch[1]), request, env, cors)
      }

      const commentsMatch = path.match(/^\/posts\/([^/]+)\/comments$/)
      if (request.method === 'GET' && commentsMatch) {
        return handleGetComments(decodeURIComponent(commentsMatch[1]), url, env, cors)
      }
      if (request.method === 'POST' && commentsMatch) {
        return handleCreateComment(decodeURIComponent(commentsMatch[1]), request, env, cors)
      }

      const reactionMatch = path.match(/^\/comments\/(\d+)\/reaction$/)
      if (request.method === 'POST' && reactionMatch) {
        return handleCommentReaction(Number(reactionMatch[1]), request, env, cors)
      }

      const moderateMatch = path.match(/^\/admin\/comments\/(\d+)\/moderate$/)
      if (request.method === 'POST' && moderateMatch) {
        return handleModerateComment(Number(moderateMatch[1]), request, env, cors)
      }

      if (request.method === 'GET' && path === '/auth/github/start') {
        return handleGithubAuthStart(request, env, cors)
      }
      if (request.method === 'GET' && path === '/auth/github/callback') {
        return handleGithubAuthCallback(request, env, cors)
      }
      if (request.method === 'GET' && path === '/auth/session') {
        return handleAuthSession(request, env, cors)
      }

      return json({ error: 'Not Found' }, 404, cors)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal server error'
      return json({ error: msg }, 500, cors)
    }
  }
}

async function handleGetMetrics (slug: string, request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  assertSlug(slug)
  await ensurePost(env, slug)
  const visitorHash = await getVisitorHash(request)
  const metrics = await getMetrics(env, slug)
  const liked = await env.DB.prepare('SELECT 1 AS liked FROM post_likes WHERE slug = ? AND visitor_hash = ? LIMIT 1')
    .bind(slug, visitorHash)
    .first<{ liked: number }>()
  return json({
    views: metrics.views,
    likes: metrics.likes,
    comments: metrics.comments,
    likedByMe: !!liked
  }, 200, cors)
}

async function handleRecordView (slug: string, request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  assertSlug(slug)
  await ensurePost(env, slug)
  const visitorHash = await getVisitorHash(request)
  const recent = await env.DB.prepare(
    "SELECT id FROM post_views WHERE slug = ? AND visitor_hash = ? AND viewed_at >= datetime('now', '-6 hours') LIMIT 1"
  ).bind(slug, visitorHash).first<{ id: number }>()

  if (!recent) {
    await env.DB.prepare('INSERT INTO post_views (slug, visitor_hash) VALUES (?, ?)').bind(slug, visitorHash).run()
    await env.DB.prepare(
      "UPDATE post_metrics SET views_count = views_count + 1, updated_at = datetime('now') WHERE slug = ?"
    ).bind(slug).run()
  }

  const metrics = await getMetrics(env, slug)
  return json({ views: metrics.views }, 200, cors)
}

async function handleLike (slug: string, request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  assertSlug(slug)
  await ensurePost(env, slug)

  const visitorHash = await getVisitorHash(request)
  const user = await getUserFromRequest(request, env)
  const payload = await parseJson(request)
  const action = normalizeAction((payload.action as string) || 'toggle')

  const existing = await env.DB.prepare('SELECT id FROM post_likes WHERE slug = ? AND visitor_hash = ? LIMIT 1')
    .bind(slug, visitorHash)
    .first<{ id: number }>()

  let liked = !!existing
  if ((action === 'like' && !existing) || (action === 'toggle' && !existing)) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO post_likes (slug, visitor_hash, user_id) VALUES (?, ?, ?)'
    ).bind(slug, visitorHash, user?.sub || null).run()
    await env.DB.prepare(
      "UPDATE post_metrics SET likes_count = likes_count + 1, updated_at = datetime('now') WHERE slug = ?"
    ).bind(slug).run()
    liked = true
  } else if ((action === 'unlike' && existing) || (action === 'toggle' && existing)) {
    await env.DB.prepare('DELETE FROM post_likes WHERE slug = ? AND visitor_hash = ?')
      .bind(slug, visitorHash)
      .run()
    await env.DB.prepare(
      "UPDATE post_metrics SET likes_count = CASE WHEN likes_count > 0 THEN likes_count - 1 ELSE 0 END, updated_at = datetime('now') WHERE slug = ?"
    ).bind(slug).run()
    liked = false
  }

  const metrics = await getMetrics(env, slug)
  return json({ liked: liked, likes: metrics.likes }, 200, cors)
}

async function handleGetComments (slug: string, url: URL, env: Env, cors: HeadersInit): Promise<Response> {
  assertSlug(slug)
  await ensurePost(env, slug)

  const cursor = Number(url.searchParams.get('cursor') || '0')
  const hasCursor = Number.isInteger(cursor) && cursor > 0

  const query = hasCursor
    ? env.DB.prepare(
      `SELECT c.id, c.parent_id, c.nickname, c.content, c.created_at,
        (SELECT COUNT(1) FROM comment_reactions cr WHERE cr.comment_id = c.id) AS reactions
       FROM comments c
       WHERE c.slug = ? AND c.status = 'approved' AND c.id < ?
       ORDER BY c.id DESC
       LIMIT ?`
    ).bind(slug, cursor, COMMENT_PAGE_SIZE)
    : env.DB.prepare(
      `SELECT c.id, c.parent_id, c.nickname, c.content, c.created_at,
        (SELECT COUNT(1) FROM comment_reactions cr WHERE cr.comment_id = c.id) AS reactions
       FROM comments c
       WHERE c.slug = ? AND c.status = 'approved'
       ORDER BY c.id DESC
       LIMIT ?`
    ).bind(slug, COMMENT_PAGE_SIZE)

  const result = await query.all<{
    id: number
    parent_id: number | null
    nickname: string
    content: string
    created_at: string
    reactions: number
  }>()

  const rows = result.results || []
  const nextCursor = rows.length >= COMMENT_PAGE_SIZE ? rows[rows.length - 1].id : null
  return json({ comments: rows, nextCursor: nextCursor }, 200, cors)
}

async function handleCreateComment (slug: string, request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  assertSlug(slug)
  await ensurePost(env, slug)

  const visitorHash = await getVisitorHash(request)
  const allowed = await rateLimit(env, 'comment:' + slug, visitorHash, 5, 3600)
  if (!allowed) return json({ error: 'Too many requests' }, 429, cors)

  const body = await parseJson(request)
  const nickname = String(body.nickname || '').trim()
  const email = String(body.email || '').trim()
  const content = String(body.content || '').trim()
  const turnstileToken = String(body.turnstileToken || '').trim()
  const parentId = body.parentId ? Number(body.parentId) : null

  if (!nickname || nickname.length > NICKNAME_MAX_LEN) {
    return json({ error: 'Invalid nickname' }, 400, cors)
  }
  if (email.length > EMAIL_MAX_LEN) {
    return json({ error: 'Invalid email length' }, 400, cors)
  }
  if (content.length < COMMENT_MIN_LEN || content.length > COMMENT_MAX_LEN) {
    return json({ error: 'Invalid content length' }, 400, cors)
  }
  if (containsBlockedContent(content)) {
    return json({ error: 'Comment contains blocked words' }, 400, cors)
  }

  const turnstileOk = await verifyTurnstile(request, env, turnstileToken)
  if (!turnstileOk) {
    return json({ error: 'Turnstile verification failed' }, 400, cors)
  }

  const user = await getUserFromRequest(request, env)
  const emailHash = email ? await sha256Hex(email.toLowerCase()) : null
  const status = 'pending'

  const inserted = await env.DB.prepare(
    'INSERT INTO comments (slug, parent_id, user_id, nickname, email_hash, content, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    slug,
    parentId,
    user?.sub || null,
    nickname,
    emailHash,
    content,
    status
  ).run()

  return json({
    ok: true,
    commentId: inserted.meta.last_row_id || null,
    status: status
  }, 201, cors)
}

async function handleCommentReaction (commentId: number, request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  if (!Number.isInteger(commentId) || commentId <= 0) return json({ error: 'Invalid comment id' }, 400, cors)

  const visitorHash = await getVisitorHash(request)
  const allowed = await rateLimit(env, 'comment-reaction:' + commentId, visitorHash, 20, 3600)
  if (!allowed) return json({ error: 'Too many requests' }, 429, cors)

  const comment = await env.DB.prepare("SELECT id FROM comments WHERE id = ? AND status = 'approved' LIMIT 1")
    .bind(commentId)
    .first<{ id: number }>()
  if (!comment) return json({ error: 'Comment not found' }, 404, cors)

  const existing = await env.DB.prepare(
    'SELECT id FROM comment_reactions WHERE comment_id = ? AND visitor_hash = ? LIMIT 1'
  ).bind(commentId, visitorHash).first<{ id: number }>()

  let reacted: boolean
  if (existing) {
    await env.DB.prepare('DELETE FROM comment_reactions WHERE comment_id = ? AND visitor_hash = ?')
      .bind(commentId, visitorHash)
      .run()
    reacted = false
  } else {
    await env.DB.prepare('INSERT OR IGNORE INTO comment_reactions (comment_id, visitor_hash) VALUES (?, ?)')
      .bind(commentId, visitorHash)
      .run()
    reacted = true
  }

  const count = await env.DB.prepare('SELECT COUNT(1) AS c FROM comment_reactions WHERE comment_id = ?')
    .bind(commentId)
    .first<{ c: number }>()

  return json({ reacted: reacted, count: count?.c || 0 }, 200, cors)
}

async function handleModerateComment (commentId: number, request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  if (!Number.isInteger(commentId) || commentId <= 0) return json({ error: 'Invalid comment id' }, 400, cors)
  const admin = await requireAdmin(request, env)
  if (!admin) return json({ error: 'Unauthorized' }, 401, cors)

  const body = await parseJson(request)
  const action = String(body.action || '').toLowerCase()
  if (action !== 'approve' && action !== 'hide') {
    return json({ error: 'Invalid action' }, 400, cors)
  }

  const row = await env.DB.prepare('SELECT id, slug, status FROM comments WHERE id = ? LIMIT 1')
    .bind(commentId)
    .first<{ id: number, slug: string, status: string }>()
  if (!row) return json({ error: 'Comment not found' }, 404, cors)

  const nextStatus = action === 'approve' ? 'approved' : 'hidden'
  await env.DB.prepare("UPDATE comments SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(nextStatus, commentId)
    .run()

  if (action === 'approve' && row.status !== 'approved') {
    await ensurePost(env, row.slug)
    await env.DB.prepare(
      "UPDATE post_metrics SET comments_count = comments_count + 1, updated_at = datetime('now') WHERE slug = ?"
    ).bind(row.slug).run()
  } else if (action === 'hide' && row.status === 'approved') {
    await ensurePost(env, row.slug)
    await env.DB.prepare(
      "UPDATE post_metrics SET comments_count = CASE WHEN comments_count > 0 THEN comments_count - 1 ELSE 0 END, updated_at = datetime('now') WHERE slug = ?"
    ).bind(row.slug).run()
  }

  return json({ ok: true, status: nextStatus }, 200, cors)
}

async function handleGithubAuthStart (request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_OAUTH_REDIRECT_URI) {
    return json({ error: 'GitHub OAuth is not configured' }, 500, cors)
  }
  const jwtSecret = env.JWT_SECRET || env.ADMIN_JWT_SECRET
  if (!jwtSecret) return json({ error: 'JWT secret is missing' }, 500, cors)

  const url = new URL(request.url)
  const redirect = safeRedirect(url.searchParams.get('redirect') || '/', request.url)
  const state = await signJwt({ redirect: redirect }, jwtSecret, 10 * 60)

  const githubUrl = new URL('https://github.com/login/oauth/authorize')
  githubUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID)
  githubUrl.searchParams.set('redirect_uri', env.GITHUB_OAUTH_REDIRECT_URI)
  githubUrl.searchParams.set('scope', 'read:user user:email')
  githubUrl.searchParams.set('state', state)

  return new Response(null, {
    status: 302,
    headers: {
      ...cors,
      Location: githubUrl.toString()
    }
  })
}

async function handleGithubAuthCallback (request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.GITHUB_OAUTH_REDIRECT_URI) {
    return json({ error: 'GitHub OAuth is not configured' }, 500, cors)
  }
  const jwtSecret = env.JWT_SECRET || env.ADMIN_JWT_SECRET
  if (!jwtSecret) return json({ error: 'JWT secret is missing' }, 500, cors)

  const url = new URL(request.url)
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  if (!code || !state) return json({ error: 'Invalid callback params' }, 400, cors)

  const statePayload = await verifyJwt(state, jwtSecret)
  if (!statePayload || typeof statePayload.redirect !== 'string') {
    return json({ error: 'Invalid OAuth state' }, 400, cors)
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: code,
      redirect_uri: env.GITHUB_OAUTH_REDIRECT_URI,
      state: state
    })
  })
  const tokenData = await tokenRes.json() as { access_token?: string, error?: string }
  const accessToken = tokenData.access_token
  if (!accessToken) {
    return json({ error: tokenData.error || 'Failed to fetch GitHub access token' }, 400, cors)
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ' + accessToken,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'yurisachan-blog-api'
    }
  })
  if (!userRes.ok) return json({ error: 'Failed to fetch GitHub user' }, 400, cors)
  const githubUser = await userRes.json() as { id: number, login: string, avatar_url?: string }

  const userId = 'github_' + githubUser.id
  const userName = githubUser.login
  const avatar = githubUser.avatar_url || ''

  await env.DB.prepare(
    `INSERT INTO users (id, provider, provider_uid, name, avatar, role)
     VALUES (?, 'github', ?, ?, ?, 'user')
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar`
  ).bind(userId, String(githubUser.id), userName, avatar).run()

  const appToken = await signJwt({
    sub: userId,
    role: 'user',
    provider: 'github',
    name: userName
  }, jwtSecret, 7 * 24 * 60 * 60)

  const redirectUrl = new URL(safeRedirect(statePayload.redirect, request.url))
  redirectUrl.searchParams.set('db_token', appToken)

  return new Response(null, {
    status: 302,
    headers: {
      ...cors,
      Location: redirectUrl.toString()
    }
  })
}

async function handleAuthSession (request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const user = await getUserFromRequest(request, env)
  return json({ user: user || null }, 200, cors)
}

async function ensurePost (env: Env, slug: string): Promise<void> {
  const title = inferTitleFromSlug(slug)
  await env.DB.prepare('INSERT OR IGNORE INTO posts (slug, title) VALUES (?, ?)')
    .bind(slug, title)
    .run()
  await env.DB.prepare('INSERT OR IGNORE INTO post_metrics (slug) VALUES (?)')
    .bind(slug)
    .run()
}

async function getMetrics (env: Env, slug: string): Promise<{ views: number, likes: number, comments: number }> {
  const row = await env.DB.prepare(
    'SELECT views_count AS views, likes_count AS likes, comments_count AS comments FROM post_metrics WHERE slug = ? LIMIT 1'
  ).bind(slug).first<{ views: number, likes: number, comments: number }>()

  return {
    views: row?.views || 0,
    likes: row?.likes || 0,
    comments: row?.comments || 0
  }
}

function normalizePath (pathname: string): string {
  const path = pathname.slice(API_PREFIX.length)
  return path.startsWith('/') ? path : '/' + path
}

function inferTitleFromSlug (slug: string): string {
  const seg = slug.split('/').pop() || slug
  return seg.replace(/[-_]/g, ' ')
}

function normalizeAction (action: string): 'toggle' | 'like' | 'unlike' {
  if (action === 'like' || action === 'unlike') return action
  return 'toggle'
}

function assertSlug (slug: string): void {
  if (!slug || slug.length > 255 || slug.includes('..')) {
    throw new Error('Invalid slug')
  }
}

async function parseJson (request: Request): Promise<JsonRecord> {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return {}
  try {
    return await request.json() as JsonRecord
  } catch {
    return {}
  }
}

function containsBlockedContent (content: string): boolean {
  const blockedWords = ['viagra', '博彩', '赌博', '免费代写', '色情']
  const normalized = content.toLowerCase()
  return blockedWords.some(function (word) { return normalized.includes(word.toLowerCase()) })
}

async function verifyTurnstile (request: Request, env: Env, token: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true
  if (!token) return false

  const body = new URLSearchParams()
  body.set('secret', env.TURNSTILE_SECRET)
  body.set('response', token)
  const ip = request.headers.get('CF-Connecting-IP')
  if (ip) body.set('remoteip', ip)

  const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: body
  })
  if (!verifyRes.ok) return false
  const data = await verifyRes.json() as { success?: boolean }
  return !!data.success
}

async function getVisitorHash (request: Request): Promise<string> {
  const anonId = request.headers.get('X-Anon-Id') || ''
  const ip = request.headers.get('CF-Connecting-IP') || ''
  const ua = request.headers.get('User-Agent') || ''
  return sha256Hex([anonId, ip, ua].join('|'))
}

async function rateLimit (
  env: Env,
  prefix: string,
  visitorHash: string,
  maxCount: number,
  windowSeconds: number
): Promise<boolean> {
  if (!env.RATE_LIMIT) return true
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000))
  const key = ['rl', prefix, visitorHash, String(bucket)].join(':')
  const count = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10)
  if (count >= maxCount) return false
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: windowSeconds + 5 })
  return true
}

async function getUserFromRequest (request: Request, env: Env): Promise<Record<string, unknown> | null> {
  const token = extractBearerToken(request)
  const secret = env.JWT_SECRET || env.ADMIN_JWT_SECRET
  if (!token || !secret) return null
  return verifyJwt(token, secret)
}

async function requireAdmin (request: Request, env: Env): Promise<Record<string, unknown> | null> {
  const token = extractBearerToken(request)
  const secret = env.ADMIN_JWT_SECRET
  if (!token || !secret) return null
  const payload = await verifyJwt(token, secret)
  if (!payload || payload.role !== 'admin') return null
  return payload
}

function extractBearerToken (request: Request): string {
  const auth = request.headers.get('Authorization') || ''
  const match = auth.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : ''
}

function buildCorsHeaders (request: Request, env: Env): HeadersInit {
  const reqOrigin = request.headers.get('Origin') || ''
  const allowOrigin = env.CORS_ORIGIN || reqOrigin || '*'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Anon-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  }
}

function json (data: JsonRecord, status: number, cors: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...cors
    }
  })
}

function safeRedirect (target: string, baseUrl: string): string {
  try {
    const base = new URL(baseUrl)
    const parsed = new URL(target, base.origin)
    if (parsed.origin !== base.origin) return base.origin + '/'
    return parsed.toString()
  } catch {
    return new URL(baseUrl).origin + '/'
  }
}

async function sha256Hex (value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes).map(function (b) {
    return b.toString(16).padStart(2, '0')
  }).join('')
}

async function signJwt (payload: Record<string, unknown>, secret: string, expiresInSec: number): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const exp = Math.floor(Date.now() / 1000) + expiresInSec
  const fullPayload = Object.assign({}, payload, { exp: exp })

  const encodedHeader = base64urlEncodeJSON(header)
  const encodedPayload = base64urlEncodeJSON(fullPayload)
  const unsigned = encodedHeader + '.' + encodedPayload
  const signature = await hmacSha256Base64Url(unsigned, secret)
  return unsigned + '.' + signature
}

async function verifyJwt (token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const unsigned = parts[0] + '.' + parts[1]
  const signature = await hmacSha256Base64Url(unsigned, secret)
  if (signature !== parts[2]) return null
  const payload = base64urlDecodeJSON(parts[1])
  if (!payload || typeof payload !== 'object') return null
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload as Record<string, unknown>
}

function base64urlEncodeJSON (value: unknown): string {
  const json = JSON.stringify(value)
  const bytes = new TextEncoder().encode(json)
  return base64urlEncodeBytes(bytes)
}

function base64urlDecodeJSON (encoded: string): JsonRecord | null {
  try {
    const bytes = base64urlDecodeBytes(encoded)
    const text = new TextDecoder().decode(bytes)
    return JSON.parse(text) as JsonRecord
  } catch {
    return null
  }
}

function base64urlEncodeBytes (bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(function (b) { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64urlDecodeBytes (base64url: string): Uint8Array {
  const normalized = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '==='.slice((normalized.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function hmacSha256Base64Url (input: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input))
  return base64urlEncodeBytes(new Uint8Array(sig))
}
