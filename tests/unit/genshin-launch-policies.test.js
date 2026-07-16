import { beforeEach, describe, expect, it } from 'vitest'

const policyPath = require.resolve('../../source/js/genshin-launch-policies.js')

function loadPolicies () {
  delete require.cache[policyPath]
  delete globalThis.__genshinLaunchPolicies
  require(policyPath)
  return globalThis.__genshinLaunchPolicies
}

describe('genshin launch pure policies', () => {
  let policies

  beforeEach(() => {
    policies = loadPolicies()
  })

  it('parses every supported boolean spelling and preserves the fallback', () => {
    for (const value of ['true', '1', 'yes', 'on', 'TRUE']) {
      expect(policies.parseBool(value, false)).toBe(true)
    }
    for (const value of ['false', '0', 'no', 'off', 'FALSE']) {
      expect(policies.parseBool(value, true)).toBe(false)
    }
    expect(policies.parseBool(undefined, true)).toBe(true)
    expect(policies.parseBool(null, false)).toBe(false)
    expect(policies.parseBool('', true)).toBe(true)
    expect(policies.parseBool('maybe', false)).toBe(false)
  })

  it('normalizes the launch query and homepage route safely', () => {
    expect(policies.getLaunchParam({ search: '?launch=preview' })).toBe('preview')
    expect(policies.getLaunchParam({ search: '' })).toBe('')
    expect(
      policies.getLaunchParam({
        get search () { throw new Error('blocked') }
      })
    ).toBe('')

    expect(policies.isHomePath('/')).toBe(true)
    expect(policies.isHomePath('///')).toBe(true)
    expect(policies.isHomePath('/index.html/')).toBe(true)
    expect(policies.isHomePath(undefined)).toBe(true)
    expect(policies.isHomePath('/about/')).toBe(false)
  })

  it('enforces eligibility precedence and every terminal reason', () => {
    const base = {
      source: 'auto',
      location: { pathname: '/', search: '' },
      launchParam: '',
      enabled: true,
      reducedMotion: false,
      saveData: false,
      webgl2: true,
      seenResult: { ok: true, seen: false }
    }

    expect(policies.evaluateEligibility()).toEqual({
      eligible: false,
      reason: 'no-webgl2',
      mode: 'auto'
    })
    expect(policies.evaluateEligibility({ ...base, launchParam: 'off', source: 'replay' }).reason).toBe('off')
    expect(policies.evaluateEligibility({ ...base, location: { pathname: '/about/', search: '' } }).reason).toBe('not-home')
    expect(policies.evaluateEligibility({ ...base, reducedMotion: true }).reason).toBe('reduced-motion')
    expect(policies.evaluateEligibility({ ...base, saveData: true }).reason).toBe('save-data')
    expect(policies.evaluateEligibility({ ...base, webgl2: false }).reason).toBe('no-webgl2')
    expect(policies.evaluateEligibility({ ...base, source: 'replay', enabled: false }).reason).toBe('replay')
    expect(policies.evaluateEligibility({ ...base, launchParam: 'preview', enabled: false }).reason).toBe('preview')
    expect(policies.evaluateEligibility({ ...base, enabled: false }).reason).toBe('disabled')
    expect(policies.evaluateEligibility({ ...base, seenResult: { ok: false, seen: false } }).reason).toBe('storage-unavailable')
    expect(policies.evaluateEligibility({ ...base, seenResult: { ok: true, seen: true } }).reason).toBe('seen')
    expect(policies.evaluateEligibility({ ...base, seenResult: undefined }).reason).toBe('first-visit')
    expect(
      policies.evaluateEligibility({
        ...base,
        source: '',
        launchParam: undefined,
        location: { pathname: '/', search: '?launch=preview' }
      })
    ).toMatchObject({ eligible: true, reason: 'preview', mode: 'preview' })
  })

  it('claims one lifecycle outcome and defaults failures safely', () => {
    expect(policies.decideFinalization(true, 'entered')).toEqual({
      accepted: false,
      outcome: null
    })
    expect(policies.decideFinalization(false, 'skipped')).toEqual({
      accepted: true,
      outcome: 'skipped'
    })
    expect(policies.decideFinalization(false)).toEqual({
      accepted: true,
      outcome: 'fallback'
    })
    expect(policies.decideFinalization(false, '')).toEqual({
      accepted: true,
      outcome: 'fallback'
    })
  })
})
