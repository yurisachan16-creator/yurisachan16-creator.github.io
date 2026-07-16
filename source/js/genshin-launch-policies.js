/**
 * Pure policies shared by the synchronous launch bootstrap.
 *
 * Keep this file free of DOM access and asynchronous work: it is loaded in
 * <head> before the bootstrap so eligibility can be decided before any 3D
 * resource is requested.
 */
;(function (root) {
  'use strict'

  function parseBool (value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    var normalized = String(value).toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false
    return fallback
  }

  function getLaunchParam (location) {
    try {
      return new URLSearchParams(location.search || '').get('launch') || ''
    } catch (_) {
      return ''
    }
  }

  function isHomePath (pathname) {
    var path = String(pathname || '/').replace(/\/+$/, '') || '/'
    return path === '/' || path === '/index.html'
  }

  /**
   * Eligibility precedence: off > route/comfort/hardware > preview/replay >
   * enabled+unseen. Storage failures bypass the experience so the site wins.
   */
  function evaluateEligibility (options) {
    options = options || {}
    var source = options.source || 'auto'
    var location = options.location || { pathname: '/', search: '' }
    var launchParam = options.launchParam !== undefined ? options.launchParam : getLaunchParam(location)

    if (launchParam === 'off') return { eligible: false, reason: 'off', mode: source }
    if (!isHomePath(location.pathname)) return { eligible: false, reason: 'not-home', mode: source }
    if (options.reducedMotion) return { eligible: false, reason: 'reduced-motion', mode: source }
    if (options.saveData) return { eligible: false, reason: 'save-data', mode: source }
    if (!options.webgl2) return { eligible: false, reason: 'no-webgl2', mode: source }

    if (source === 'replay') return { eligible: true, reason: 'replay', mode: 'replay' }
    if (launchParam === 'preview') return { eligible: true, reason: 'preview', mode: 'preview' }
    if (!options.enabled) return { eligible: false, reason: 'disabled', mode: 'auto' }

    var seenResult = options.seenResult || { ok: true, seen: false }
    if (!seenResult.ok) return { eligible: false, reason: 'storage-unavailable', mode: 'auto' }
    if (seenResult.seen) return { eligible: false, reason: 'seen', mode: 'auto' }
    return { eligible: true, reason: 'first-visit', mode: 'auto' }
  }

  /**
   * Claims a terminal outcome without mutating the caller's generation state.
   * The bootstrap applies the accepted decision before it starts cleanup.
   */
  function decideFinalization (alreadyFinalized, outcome) {
    if (alreadyFinalized) return { accepted: false, outcome: null }
    return { accepted: true, outcome: outcome || 'fallback' }
  }

  root.__genshinLaunchPolicies = Object.freeze({
    parseBool: parseBool,
    getLaunchParam: getLaunchParam,
    isHomePath: isHomePath,
    evaluateEligibility: evaluateEligibility,
    decideFinalization: decideFinalization
  })
})(globalThis)
