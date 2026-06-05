import { describe, expect, it } from 'vitest'
import { parseArgs, parseTtl, signJwt } from '../../tools/sign-admin-jwt.mjs'

function decodePayload (token) {
  const payload = token.split('.')[1]
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

describe('admin token helper', () => {
  it('parses ttl suffixes in seconds, minutes, hours and days', () => {
    expect(parseTtl('60')).toBe(60)
    expect(parseTtl('15m')).toBe(15 * 60)
    expect(parseTtl('2h')).toBe(2 * 60 * 60)
    expect(parseTtl('1d')).toBe(24 * 60 * 60)
    expect(Number.isNaN(parseTtl('soon'))).toBe(true)
  })

  it('parses command arguments without reading secrets', () => {
    expect(parseArgs(['--ttl', '1h', '--subject', 'yurisa', '--name', 'Admin', '--json'])).toEqual({
      ttl: '1h',
      subject: 'yurisa',
      name: 'Admin',
      json: true
    })
  })

  it('signs a role=admin JWT payload', () => {
    const token = signJwt({
      sub: 'test-admin',
      role: 'admin',
      iat: 1780644300,
      exp: 1780647900
    }, 'unit-test-secret')

    expect(token.split('.')).toHaveLength(3)
    expect(decodePayload(token)).toMatchObject({
      sub: 'test-admin',
      role: 'admin',
      iat: 1780644300,
      exp: 1780647900
    })
  })
})
