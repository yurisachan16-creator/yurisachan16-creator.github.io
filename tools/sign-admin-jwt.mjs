import crypto from 'node:crypto'

const defaults = {
  secretEnv: 'ADMIN_JWT_SECRET',
  subject: 'blog-admin',
  ttl: 60 * 60
}

function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printUsage()
    return
  }

  const secretEnv = options.secretEnv || defaults.secretEnv
  const secret = process.env[secretEnv]
  if (!secret) {
    console.error('[admin-token] missing secret. Set ' + secretEnv + ' before running this command.')
    process.exitCode = 1
    return
  }

  const ttl = parseTtl(options.ttl || String(defaults.ttl))
  if (!Number.isInteger(ttl) || ttl <= 0) {
    console.error('[admin-token] --ttl must be a positive number of seconds.')
    process.exitCode = 1
    return
  }

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: options.subject || defaults.subject,
    role: 'admin',
    iat: now,
    exp: now + ttl
  }
  if (options.name) payload.name = options.name

  const token = signJwt(payload, secret)
  if (options.json) {
    console.log(JSON.stringify({
      token: token,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      subject: payload.sub
    }, null, 2))
    return
  }

  console.log(token)
}

export function parseArgs (args) {
  const options = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--subject' || arg === '--sub') {
      options.subject = args[++i] || ''
    } else if (arg === '--name') {
      options.name = args[++i] || ''
    } else if (arg === '--ttl') {
      options.ttl = args[++i] || ''
    } else if (arg === '--secret-env') {
      options.secretEnv = args[++i] || ''
    } else {
      throw new Error('Unknown argument: ' + arg)
    }
  }
  return options
}

export function parseTtl (value) {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d+)([smhd])?$/i)
  if (!match) return NaN
  const amount = Number(match[1])
  const unit = (match[2] || 's').toLowerCase()
  const multipliers = { s: 1, m: 60, h: 60 * 60, d: 24 * 60 * 60 }
  return amount * multipliers[unit]
}

export function signJwt (payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = base64url(JSON.stringify(header))
  const encodedPayload = base64url(JSON.stringify(payload))
  const unsigned = encodedHeader + '.' + encodedPayload
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url')
  return unsigned + '.' + signature
}

function base64url (value) {
  return Buffer.from(value).toString('base64url')
}

function printUsage () {
  console.log([
    'Usage:',
    '  ADMIN_JWT_SECRET=... npm run admin:token -- --ttl 1h --subject yurisa',
    '',
    'Options:',
    '  --ttl <duration>       Token lifetime, supports s/m/h/d suffix. Default: 3600s',
    '  --subject <value>      JWT sub claim. Default: blog-admin',
    '  --name <value>         Optional display name claim',
    '  --secret-env <name>    Secret env var name. Default: ADMIN_JWT_SECRET',
    '  --json                Print token metadata as JSON'
  ].join('\n'))
}

if (isDirectRun()) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function isDirectRun () {
  return process.argv[1] && process.argv[1].endsWith('sign-admin-jwt.mjs')
}
