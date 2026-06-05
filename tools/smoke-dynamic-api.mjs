import http from 'node:http'

const DEFAULT_ORIGIN = 'https://yurisa.top'

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printUsage()
    return
  }

  if (options.mock) {
    await runMockSmoke(options)
    return
  }

  const apiBase = options.apiBase || process.env.BLOG_API_BASE
  if (!apiBase) {
    console.error('[api-smoke] BLOG_API_BASE is required. Refusing to guess a production target.')
    process.exitCode = 1
    return
  }

  await runSmoke({
    apiBase: apiBase,
    adminToken: options.adminToken || process.env.ADMIN_JWT || '',
    origin: options.origin || process.env.BLOG_SMOKE_ORIGIN || DEFAULT_ORIGIN,
    slug: options.slug || process.env.BLOG_SMOKE_SLUG || '',
    allowWrites: options.allowWrites || process.env.BLOG_SMOKE_ALLOW_WRITES === 'true'
  })
}

export async function runMockSmoke (options) {
  const server = http.createServer(function (req, res) {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin || DEFAULT_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Anon-Id',
      Vary: 'Origin'
    }
    Object.entries(cors).forEach(function ([key, value]) {
      res.setHeader(key, value)
    })

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')

    if (url.pathname === '/api/v1/admin/comments') {
      if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
        res.writeHead(401)
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }
      res.writeHead(200)
      res.end(JSON.stringify({ comments: [], nextCursor: null }))
      return
    }

    if (/^\/api\/v1\/posts\/[^/]+\/metrics$/.test(url.pathname)) {
      res.writeHead(200)
      res.end(JSON.stringify({ views: 1, likes: 0, comments: 0, likedByMe: false }))
      return
    }

    if (/^\/api\/v1\/posts\/[^/]+\/comments$/.test(url.pathname)) {
      res.writeHead(200)
      res.end(JSON.stringify({ comments: [], nextCursor: null }))
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not Found' }))
  })

  await new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  const port = address && typeof address === 'object' ? address.port : 0
  try {
    await runSmoke({
      apiBase: 'http://127.0.0.1:' + port + '/api/v1',
      adminToken: options.adminToken || 'mock-admin-token',
      origin: options.origin || DEFAULT_ORIGIN,
      slug: options.slug || 'mock-smoke-post',
      allowWrites: true
    })
  } finally {
    await new Promise(function (resolve) {
      server.close(resolve)
    })
  }
}

export async function runSmoke (options) {
  const apiBase = normalizeApiBase(options.apiBase)
  const checks = []

  checks.push(await checkPreflight(apiBase, options.origin))
  checks.push(await checkAdminAuthBoundary(apiBase, options.origin))

  if (options.adminToken) {
    checks.push(await checkAdminList(apiBase, options.origin, options.adminToken))
  } else {
    checks.push({ name: 'admin-list-authorized', skipped: true, reason: 'ADMIN_JWT not provided' })
  }

  if (options.allowWrites && options.slug) {
    checks.push(await checkPublicMetrics(apiBase, options.origin, options.slug))
    checks.push(await checkPublicComments(apiBase, options.origin, options.slug))
  } else {
    checks.push({
      name: 'public-post-read',
      skipped: true,
      reason: 'requires BLOG_SMOKE_ALLOW_WRITES=true and BLOG_SMOKE_SLUG because Worker public reads ensure post rows'
    })
  }

  const failed = checks.filter(function (check) { return check.ok === false })
  checks.forEach(function (check) {
    if (check.skipped) {
      console.log('[skip] ' + check.name + ': ' + check.reason)
    } else {
      console.log((check.ok ? '[ok] ' : '[fail] ') + check.name + (check.detail ? ': ' + check.detail : ''))
    }
  })

  if (failed.length) {
    process.exitCode = 1
    return checks
  }

  console.log('[api-smoke] complete')
  return checks
}

export async function checkPreflight (apiBase, origin) {
  const response = await fetch(apiBase + '/admin/comments', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization'
    }
  })
  const allowOrigin = response.headers.get('access-control-allow-origin') || ''
  return {
    name: 'cors-preflight',
    ok: response.status === 204 && !!allowOrigin,
    detail: 'status=' + response.status + ', allow-origin=' + allowOrigin
  }
}

export async function checkAdminAuthBoundary (apiBase, origin) {
  const response = await fetch(apiBase + '/admin/comments?status=pending', {
    headers: { Origin: origin }
  })
  return {
    name: 'admin-auth-boundary',
    ok: response.status === 401,
    detail: 'status=' + response.status
  }
}

export async function checkAdminList (apiBase, origin, adminToken) {
  const response = await fetch(apiBase + '/admin/comments?status=pending', {
    headers: {
      Origin: origin,
      Authorization: 'Bearer ' + adminToken
    }
  })
  const body = await readJson(response)
  const ok = response.status === 200 && Array.isArray(body.comments) && Object.prototype.hasOwnProperty.call(body, 'nextCursor')
  return {
    name: 'admin-list-authorized',
    ok: ok,
    detail: 'status=' + response.status + ', comments=' + (Array.isArray(body.comments) ? body.comments.length : 'n/a')
  }
}

export async function checkPublicMetrics (apiBase, origin, slug) {
  const response = await fetch(apiBase + '/posts/' + encodeURIComponent(slug) + '/metrics', {
    headers: {
      Origin: origin,
      'X-Anon-Id': 'api-smoke'
    }
  })
  const body = await readJson(response)
  const ok = response.status === 200 &&
    typeof body.views === 'number' &&
    typeof body.likes === 'number' &&
    typeof body.comments === 'number' &&
    typeof body.likedByMe === 'boolean'
  return {
    name: 'public-metrics',
    ok: ok,
    detail: 'status=' + response.status
  }
}

export async function checkPublicComments (apiBase, origin, slug) {
  const response = await fetch(apiBase + '/posts/' + encodeURIComponent(slug) + '/comments', {
    headers: {
      Origin: origin,
      'X-Anon-Id': 'api-smoke'
    }
  })
  const body = await readJson(response)
  const ok = response.status === 200 && Array.isArray(body.comments) && Object.prototype.hasOwnProperty.call(body, 'nextCursor')
  return {
    name: 'public-comments',
    ok: ok,
    detail: 'status=' + response.status + ', comments=' + (Array.isArray(body.comments) ? body.comments.length : 'n/a')
  }
}

async function readJson (response) {
  try {
    return await response.json()
  } catch (_) {
    return {}
  }
}

export function normalizeApiBase (value) {
  return String(value || '').replace(/\/+$/, '')
}

export function parseArgs (args) {
  const options = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--mock') {
      options.mock = true
    } else if (arg === '--allow-writes') {
      options.allowWrites = true
    } else if (arg === '--api-base') {
      options.apiBase = args[++i] || ''
    } else if (arg === '--admin-token') {
      options.adminToken = args[++i] || ''
    } else if (arg === '--origin') {
      options.origin = args[++i] || ''
    } else if (arg === '--slug') {
      options.slug = args[++i] || ''
    } else {
      throw new Error('Unknown argument: ' + arg)
    }
  }
  return options
}

function printUsage () {
  console.log([
    'Usage:',
    '  BLOG_API_BASE=https://api.yurisa.top/api/v1 ADMIN_JWT=... npm run smoke:api',
    '  npm run smoke:api -- --mock',
    '',
    'Options:',
    '  --api-base <url>       API base URL, same shape as /api/v1',
    '  --admin-token <jwt>    Admin JWT. Prefer ADMIN_JWT env to avoid shell history.',
    '  --origin <url>         Origin header for CORS checks. Default: https://yurisa.top',
    '  --slug <slug>          Article slug for optional public endpoint checks',
    '  --allow-writes         Also check public metrics/comments; may ensure post rows in D1',
    '  --mock                 Run against an in-process mock API'
  ].join('\n'))
}

if (isDirectRun()) {
  main().catch(function (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

function isDirectRun () {
  return process.argv[1] && process.argv[1].endsWith('smoke-dynamic-api.mjs')
}
