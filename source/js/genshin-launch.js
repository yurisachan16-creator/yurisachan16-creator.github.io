;(function (root, factory) {
  'use strict'

  var policies = root.__genshinLaunchPolicies || globalThis.__genshinLaunchPolicies
  if (!policies && typeof module !== 'undefined' && module.exports) {
    require('./genshin-launch-policies.js')
    policies = globalThis.__genshinLaunchPolicies
  }
  if (!policies) return

  var api = factory(root, policies)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
    return
  }

  root.__genshinLaunch = api.createCoordinator()
  root.__genshinLaunch.bootstrap()
})(typeof window !== 'undefined' ? window : globalThis, function (window, policies) {
  'use strict'

  var SESSION_KEY = 'yurisa_launch_seen_v2'
  var COMPLETE_EVENT = 'yurisa:launch-complete'
  var REPLAY_EVENT = 'yurisa:launch-replay'
  var BUTTON_ID = 'genshin-launch-replay-btn'
  var MANIFEST_URL = '/assets/launch/manifest.json'
  var generationCounter = 0

  var parseBool = policies.parseBool
  var getLaunchParam = policies.getLaunchParam
  var isHomePath = policies.isHomePath
  var evaluateEligibility = policies.evaluateEligibility
  var decideFinalization = policies.decideFinalization

  function hasReducedMotion (window) {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    } catch (_) {
      return true
    }
  }

  function hasSaveData (navigator) {
    try {
      var connection = navigator && (navigator.connection || navigator.mozConnection || navigator.webkitConnection)
      return !!(connection && connection.saveData)
    } catch (_) {
      return true
    }
  }

  function supportsWebGL2 (window, document) {
    if (!window || !window.WebGL2RenderingContext || !document || !document.createElement) return false
    var canvas
    var context
    try {
      canvas = document.createElement('canvas')
      context = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        failIfMajorPerformanceCaveat: true,
        powerPreference: 'high-performance',
        stencil: false
      })
      if (!context) return false
      var lose = context.getExtension && context.getExtension('WEBGL_lose_context')
      if (lose && lose.loseContext) lose.loseContext()
      return true
    } catch (_) {
      return false
    } finally {
      canvas = null
      context = null
    }
  }

  function readEnabledMeta (document) {
    try {
      var meta = document && document.querySelector && document.querySelector('meta[name="yurisa-launch-enabled"]')
      return parseBool(meta && meta.content, false)
    } catch (_) {
      return false
    }
  }

  function readSeen (storage) {
    try {
      return { ok: true, seen: storage.getItem(SESSION_KEY) === '1' }
    } catch (_) {
      return { ok: false, seen: false }
    }
  }

  function markSeen (storage) {
    try {
      storage.setItem(SESSION_KEY, '1')
      return true
    } catch (_) {
      return false
    }
  }

  function shellMarkup () {
    return '' +
      '<div class="yurisa-launch__shell">' +
        '<div class="yurisa-launch__sky" aria-hidden="true"></div>' +
        '<div class="yurisa-launch__scene" aria-hidden="true"></div>' +
        '<div class="yurisa-launch__whiteout" aria-hidden="true"></div>' +
        '<h1 class="yurisa-launch__title" id="yurisa-launch-title" tabindex="-1">通往天空之门</h1>' +
        '<section class="yurisa-launch__loader" aria-labelledby="yurisa-launch-title">' +
          '<header class="yurisa-launch__brand" aria-hidden="true">' +
            '<img class="yurisa-launch__brand-logo" src="/img/pixel-logo.png" alt="">' +
            '<span>YURISACHAN</span>' +
          '</header>' +
          '<div class="yurisa-launch__status-row">' +
            '<p class="yurisa-launch__status" data-launch-status aria-live="polite">正在连接天空长廊</p>' +
            '<span class="yurisa-launch__progress-value" data-launch-progress-value aria-hidden="true">0%</span>' +
          '</div>' +
          '<div class="yurisa-launch__progress" data-launch-progress role="progressbar" aria-label="启动资源加载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="正在连接天空长廊">' +
            '<span class="yurisa-launch__progress-fill"></span>' +
          '</div>' +
          '<p class="yurisa-launch__loader-hint"><span>ESC</span><span>随时跳过</span></p>' +
        '</section>' +
        '<nav class="yurisa-launch__tools" data-visible="false" aria-label="启动辅助工具" aria-hidden="true" inert>' +
          '<button class="yurisa-launch__tool yurisa-launch__skip" type="button" data-action="skip" data-tooltip="跳过" aria-label="跳过启动画面，进入博客" hidden>' +
            '<i class="yurisa-launch__icon yurisa-launch__icon--skip" aria-hidden="true"></i><span class="yurisa-launch__sr-only" data-launch-control-label>跳过</span>' +
          '</button>' +
          '<button class="yurisa-launch__tool" type="button" data-action="mute" data-tooltip="静音" aria-label="静音" aria-pressed="false" disabled>' +
            '<i class="yurisa-launch__icon yurisa-launch__icon--volume" data-launch-control-icon aria-hidden="true"></i><span class="yurisa-launch__sr-only" data-launch-control-label>静音</span>' +
          '</button>' +
          '<a class="yurisa-launch__tool yurisa-launch__credits" data-launch-credits data-tooltip="来源" href="/credits/" target="_blank" rel="noopener" aria-label="查看非官方演示的素材与实现来源">' +
            '<i class="yurisa-launch__icon yurisa-launch__icon--external" aria-hidden="true"></i><span class="yurisa-launch__sr-only" data-launch-control-label>来源</span>' +
          '</a>' +
        '</nav>' +
        '<button class="yurisa-launch__primary" type="button" data-action="primary" aria-label="启动天空长廊" hidden>' +
          '<span class="yurisa-launch__primary-surface" data-launch-primary-surface>' +
            '<i class="yurisa-launch__icon yurisa-launch__icon--play yurisa-launch__primary-icon yurisa-launch__primary-icon--start" aria-hidden="true"></i>' +
            '<span data-launch-button-label>启动 / Press Start</span>' +
            '<i class="yurisa-launch__icon yurisa-launch__icon--arrow yurisa-launch__primary-icon yurisa-launch__primary-icon--enter" aria-hidden="true"></i>' +
          '</span>' +
        '</button>' +
      '</div>'
  }

  function createHost (document, generation) {
    var host = document.createElement('div')
    host.className = 'yurisa-launch'
    host.dataset.phase = 'loading'
    host.dataset.generation = String(generation)
    host.setAttribute('role', 'dialog')
    host.setAttribute('aria-modal', 'true')
    host.setAttribute('aria-labelledby', 'yurisa-launch-title')
    host.innerHTML = shellMarkup()
    return host
  }

  function focusableElements (host) {
    if (!host || !host.querySelectorAll) return []
    return Array.prototype.slice.call(host.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (element) {
      return !element.hidden && element.getAttribute('aria-hidden') !== 'true' && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    })
  }

  function trapFocus (event, host) {
    if (event.key !== 'Tab') return
    var focusable = focusableElements(host)
    if (!focusable.length) {
      event.preventDefault()
      var title = host.querySelector('.yurisa-launch__title')
      if (title) title.focus()
      return
    }
    var first = focusable[0]
    var last = focusable[focusable.length - 1]
    var ownerDocument = host.ownerDocument
    if (event.shiftKey && (ownerDocument.activeElement === first || !host.contains(ownerDocument.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (ownerDocument.activeElement === last || !host.contains(ownerDocument.activeElement))) {
      event.preventDefault()
      first.focus()
    }
  }

  function setProgress (host, value) {
    if (!host) return
    var progress = host.querySelector('[data-launch-progress]')
    var progressValue = host.querySelector('[data-launch-progress-value]')
    var status = host.querySelector('[data-launch-status]')
    var numeric = typeof value === 'number' ? value : value && (value.value !== undefined ? value.value : (value.progress !== undefined ? value.progress : value.ratio))
    var label = value && typeof value === 'object' && (value.label || value.status)
    if (Number.isFinite(numeric)) {
      if (numeric <= 1) numeric *= 100
      numeric = Math.max(0, Math.min(100, Math.round(numeric)))
      if (progress) {
        progress.setAttribute('aria-valuenow', String(numeric))
        progress.style.setProperty('--launch-progress', numeric + '%')
        var fill = progress.querySelector('.yurisa-launch__progress-fill')
        if (fill) fill.style.removeProperty('width')
      }
      if (progressValue) progressValue.textContent = numeric + '%'
    }
    if (label) {
      if (status) status.textContent = String(label)
      if (progress) progress.setAttribute('aria-valuetext', String(label))
    }
  }

  function validateManifest (manifest, location) {
    if (!manifest || typeof manifest !== 'object' || !manifest.version || typeof manifest.entry !== 'string') {
      throw new Error('Invalid launch manifest')
    }
    var entry = new URL(manifest.entry, location.href)
    if (entry.origin !== location.origin || entry.pathname.indexOf('/assets/launch/') !== 0) {
      throw new Error('Unsafe launch entry URL')
    }
    if (!manifest.assets || typeof manifest.assets !== 'object') throw new Error('Launch assets are missing')
    var required = manifest.requiredAssetIds
    if (!Array.isArray(required) || required.some(function (id) {
      return !manifest.assets[id] || manifest.assets[id].critical !== true
    })) throw new Error('Invalid required assets')
    return entry.href
  }

  function createCoordinator (overrides) {
    overrides = overrides || {}
    var document = overrides.document || window.document
    var location = overrides.location || window.location
    var navigator = overrides.navigator || window.navigator
    var storage = overrides.storage
    if (!storage) {
      try {
        storage = window.sessionStorage
      } catch (_) {
        storage = {
          getItem: function () { throw new Error('Session storage is unavailable') },
          setItem: function () { throw new Error('Session storage is unavailable') }
        }
      }
    }
    var fetchFn = overrides.fetch || (window.fetch && window.fetch.bind(window))
    var importModule = overrides.importModule || function (url) { return import(url) }
    var setTimer = overrides.setTimeout || window.setTimeout.bind(window)
    var clearTimer = overrides.clearTimeout || window.clearTimeout.bind(window)
    var requestFrame = overrides.requestAnimationFrame || (window.requestAnimationFrame
      ? window.requestAnimationFrame.bind(window)
      : function (callback) { return setTimer(function () { callback(Date.now()) }, 16) })
    var requestIdle = overrides.requestIdleCallback || window.requestIdleCallback
    var current = null
    var cleanupPending = 0
    var listenersBound = false
    var initialCandidateTimer = 0
    var webgl2Result

    function getWebGL2Support () {
      if (overrides.webgl2 !== undefined) return overrides.webgl2
      if (webgl2Result === undefined) webgl2Result = supportsWebGL2(window, document)
      return webgl2Result
    }
    var replayDisabled = false

    function getEligibility (source) {
      return evaluateEligibility({
        source: source,
        location: location,
        enabled: readEnabledMeta(document),
        reducedMotion: hasReducedMotion(window),
        saveData: hasSaveData(navigator),
        get webgl2 () { return getWebGL2Support() },
        seenResult: readSeen(storage)
      })
    }

    function suspendLive2D (instance) {
      try {
        var assistant = window.__live2dAssistant
        if (!assistant) return true
        instance.live2dAssistant = assistant
        if (typeof assistant.suspendForLaunch !== 'function' || typeof assistant.resumeFromLaunch !== 'function') return false
        return assistant.suspendForLaunch() === true
      } catch (_) {
        return false
      }
    }

    function resumeLive2D (instance) {
      try {
        var assistant = instance.live2dAssistant || window.__live2dAssistant
        if (!assistant || typeof assistant.resumeFromLaunch !== 'function') return
        var result = assistant.resumeFromLaunch()
        if (result && typeof result.catch === 'function') result.catch(function () {})
      } catch (_) {}
    }

    function restoreFocus (instance) {
      var target = instance.restoreFocus
      if (target && target.id === BUTTON_ID) target = document.getElementById('site-title')
      if (!target || !target.isConnected || typeof target.focus !== 'function') target = document.getElementById('site-title')
      if (!target || typeof target.focus !== 'function') return
      if (!target.matches('a,button,input,select,textarea,[tabindex]')) target.setAttribute('tabindex', '-1')
      try { target.focus({ preventScroll: true }) } catch (_) { try { target.focus() } catch (_) {} }
    }

    function unlockDom (instance) {
      if (instance.pageObserver) {
        try { instance.pageObserver.disconnect() } catch (_) {}
        instance.pageObserver = null
      }
      if (instance.host && instance.host.parentNode) instance.host.parentNode.removeChild(instance.host)
      instance.locked.forEach(function (record) {
        try {
          record.element.inert = record.inert
          if (record.hadInertAttribute) record.element.setAttribute('inert', '')
          else record.element.removeAttribute('inert')
        } catch (_) {}
      })
      document.documentElement.classList.remove('yurisa-launch-active')
      document.body && document.body.classList.remove('yurisa-launch-active')
      if (current === instance) document.documentElement.removeAttribute('data-launch-state')
      restoreFocus(instance)
    }

    function announceFallback () {
      if (!document.body) return
      var previous = document.querySelector('[data-launch-announcer]')
      if (previous) previous.remove()
      var announcer = document.createElement('p')
      announcer.dataset.launchAnnouncer = 'true'
      announcer.setAttribute('role', 'status')
      announcer.setAttribute('aria-live', 'polite')
      announcer.style.cssText = 'position:fixed;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
      announcer.textContent = '已为你打开博客'
      document.body.appendChild(announcer)
      setTimer(function () { if (announcer.parentNode) announcer.parentNode.removeChild(announcer) }, 1600)
    }

    function deferCleanup (work, after) {
      var done = false
      var fallbackTimer = 0
      cleanupPending += 1
      injectReplayButton()
      function run () {
        if (done) return
        done = true
        if (fallbackTimer) clearTimer(fallbackTimer)
        try { work() } finally {
          cleanupPending = Math.max(0, cleanupPending - 1)
          injectReplayButton()
          if (after) after()
        }
      }
      fallbackTimer = setTimer(run, 1000)
      requestFrame(function () { requestFrame(function () {
        requestIdle ? requestIdle.call(window, run, { timeout: 900 }) : setTimer(run, 0)
      }) })
    }

    function pauseHandle (handle) {
      if (!handle || typeof handle.pause !== 'function') return
      try { handle.pause(true) } catch (_) {}
    }

    function disposeHandle (handle) {
      if (!handle || typeof handle.dispose !== 'function') return
      try { handle.dispose() } catch (_) {}
    }

    function dispatchComplete (instance) {
      try {
        document.dispatchEvent(new window.CustomEvent(COMPLETE_EVENT, {
          detail: { generation: instance.generation, outcome: instance.outcome }
        }))
      } catch (_) {}
    }

    function finalizeInstance (instance, outcome) {
      var decision = decideFinalization(!instance || instance.finalized, outcome)
      if (!decision.accepted) return false
      instance.finalized = true
      instance.outcome = decision.outcome
      instance.timers.forEach(clearTimer)
      instance.timers.length = 0
      document.removeEventListener('keydown', instance.onKeyDown, true)
      document.removeEventListener('click', instance.onClick, true)

      pauseHandle(instance.handle)
      unlockDom(instance)
      if (current === instance) current = null
      if (instance.outcome === 'fallback') {
        replayDisabled = true
        announceFallback()
      }
      deferCleanup(function () {
        if (instance.abortController) instance.abortController.abort()
        disposeHandle(instance.handle)
        resumeLive2D(instance)
        instance.cleanupFinished = true
      }, function () { dispatchComplete(instance) })
      return true
    }

    function finalize (outcome) {
      return finalizeInstance(current, outcome)
    }

    function lockPageSiblings (instance) {
      var siblings = Array.prototype.slice.call(document.body.children)
      siblings.forEach(function (element) {
        if (element === instance.host || /^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/.test(element.tagName)) return
        if (instance.locked.some(function (record) { return record.element === element })) return
        instance.locked.push({
          element: element,
          inert: !!element.inert,
          hadInertAttribute: element.hasAttribute('inert')
        })
        try {
          element.inert = true
          element.setAttribute('inert', '')
        } catch (_) {}
      })
    }

    function lockPage (instance) {
      lockPageSiblings(instance)
      document.documentElement.classList.add('yurisa-launch-active')
      document.body.classList.add('yurisa-launch-active')
      document.documentElement.dataset.launchState = 'active'
    }

    function schedule (instance, callback, delay) {
      var id = setTimer(function () {
        var index = instance.timers.indexOf(id)
        if (index >= 0) instance.timers.splice(index, 1)
        if (!instance.finalized && current === instance) callback()
      }, delay)
      instance.timers.push(id)
      return id
    }

    function clearScheduledTimer (instance, id) {
      if (!id) return
      clearTimer(id)
      var index = instance.timers.indexOf(id)
      if (index >= 0) instance.timers.splice(index, 1)
    }

    function resetStallTimer (instance) {
      if (instance.firstFrame) return
      clearScheduledTimer(instance, instance.stallTimer)
      instance.stallTimer = schedule(instance, function () { finalizeInstance(instance, 'fallback') }, 10000)
    }

    function mount (source, trigger, eligibility) {
      if (!document.body || current) return false

      var generation = ++generationCounter
      var instance = {
        generation: generation,
        source: source,
        eligibility: eligibility,
        host: null,
        handle: null,
        locked: [],
        pageObserver: null,
        timers: [],
        stallTimer: 0,
        totalTimer: 0,
        firstFrame: false,
        finalized: false,
        cleanupFinished: false,
        outcome: null,
        restoreFocus: trigger || null,
        live2dAssistant: null,
        abortController: typeof window.AbortController === 'function' ? new window.AbortController() : null,
        onKeyDown: null,
        onClick: null
      }
      current = instance

      try {
        if (!suspendLive2D(instance)) {
          current = null
          document.documentElement.removeAttribute('data-launch-state')
          return false
        }
        if (eligibility.mode === 'auto' && !markSeen(storage)) {
          current = null
          document.documentElement.removeAttribute('data-launch-state')
          resumeLive2D(instance)
          return false
        }

        instance.host = createHost(document, generation)
        document.body.appendChild(instance.host)
        lockPage(instance)
        if (typeof window.MutationObserver === 'function') {
          instance.pageObserver = new window.MutationObserver(function () {
            if (!instance.finalized && current === instance) lockPageSiblings(instance)
          })
          instance.pageObserver.observe(document.body, { childList: true })
        }
        instance.onKeyDown = function (event) {
          if (event.key === 'Escape') {
            event.preventDefault()
            finalizeInstance(instance, 'skipped')
            return
          }
          trapFocus(event, instance.host)
        }
        instance.onClick = function (event) {
          var action = event.target && event.target.closest && event.target.closest('[data-action="skip"]')
          if (action && instance.host.contains(action)) {
            event.preventDefault()
            finalizeInstance(instance, 'skipped')
          }
        }
        document.addEventListener('keydown', instance.onKeyDown, true)
        document.addEventListener('click', instance.onClick, true)
        var title = instance.host.querySelector('.yurisa-launch__title')
        if (title) title.focus({ preventScroll: true })

        schedule(instance, function () {
          var skip = instance.host.querySelector('[data-action="skip"]')
          var tools = instance.host.querySelector('.yurisa-launch__tools')
          var phase = instance.host.dataset.phase
          if (phase === 'entering' || phase === 'complete') return
          if (skip) skip.hidden = false
          if (tools) {
            tools.dataset.visible = 'true'
            tools.removeAttribute('inert')
            tools.setAttribute('aria-hidden', 'false')
          }
        }, 2000)
        instance.totalTimer = schedule(instance, function () { finalizeInstance(instance, 'fallback') }, 30000)
        resetStallTimer(instance)
      } catch (_) {
        finalizeInstance(instance, 'fallback')
        return false
      }

      if (!fetchFn) {
        finalizeInstance(instance, 'fallback')
        return false
      }

      var fetchOptions = { cache: 'no-cache', credentials: 'same-origin' }
      if (instance.abortController) fetchOptions.signal = instance.abortController.signal
      Promise.resolve(fetchFn(MANIFEST_URL, fetchOptions))
        .then(function (response) {
          if (!response || !response.ok) throw new Error('Launch manifest request failed')
          resetStallTimer(instance)
          return response.json()
        })
        .then(function (manifest) {
          var entryUrl = validateManifest(manifest, location)
          resetStallTimer(instance)
          return Promise.all([manifest, importModule(entryUrl)])
        })
        .then(function (result) {
          var manifest = result[0]
          var runtime = result[1]
          if (instance.finalized || current !== instance) return
          if (!runtime || typeof runtime.mountLaunchExperience !== 'function') throw new Error('Launch runtime export is missing')
          return runtime.mountLaunchExperience({
            host: instance.host,
            generation: generation,
            manifest: manifest,
            signal: instance.abortController ? instance.abortController.signal : undefined,
            onRequestFinalize: function (outcome) { finalizeInstance(instance, outcome) },
            onFirstFrame: function () {
              if (instance.finalized || current !== instance) return
              instance.firstFrame = true
              clearScheduledTimer(instance, instance.stallTimer)
              clearScheduledTimer(instance, instance.totalTimer)
              instance.stallTimer = 0
              instance.totalTimer = 0
              instance.host.dataset.firstFrame = 'true'
            },
            onProgress: function (progress) {
              if (instance.finalized || current !== instance) return
              resetStallTimer(instance)
              setProgress(instance.host, progress)
            }
          })
        })
        .then(function (handle) {
          if (!handle) return
          if (instance.finalized || current !== instance) {
            pauseHandle(handle)
            if (!instance.cleanupFinished) instance.handle = handle
            else deferCleanup(function () { disposeHandle(handle) })
            return
          }
          instance.handle = handle
        })
        .catch(function (error) {
          if (error && error.name === 'AbortError') return
          finalizeInstance(instance, 'fallback')
        })
      return true
    }

    function start (source, trigger) {
      source = source || 'auto'
      if (current) return false
      if (cleanupPending || (source === 'replay' && replayDisabled)) return false
      var eligibility = getEligibility(source)
      if (!eligibility.eligible) {
        if (source === 'auto') document.documentElement.removeAttribute('data-launch-state')
        return false
      }

      document.documentElement.dataset.launchState = 'candidate'
      if (document.body) return mount(source, trigger, eligibility)
      var observer = new window.MutationObserver(function () {
        if (!document.body) return
        observer.disconnect()
        clearTimer(initialCandidateTimer)
        mount(source, trigger, eligibility)
      })
      observer.observe(document.documentElement, { childList: true })
      initialCandidateTimer = setTimer(function () {
        observer.disconnect()
        document.documentElement.removeAttribute('data-launch-state')
      }, 2000)
      return true
    }

    function shouldOfferReplay () {
      return isHomePath(location.pathname) && getLaunchParam(location) !== 'off' && (readEnabledMeta(document) || getLaunchParam(location) === 'preview')
    }

    function injectReplayButton () {
      var existing = document.getElementById(BUTTON_ID)
      if (!shouldOfferReplay()) {
        if (existing) existing.remove()
        return false
      }
      if (existing) {
        var existingEligibility = getEligibility('replay')
        existing.disabled = cleanupPending > 0 || replayDisabled || !existingEligibility.eligible
        if (existing.disabled) {
          existing.title = replayDisabled ? '启动场景本次加载失败' : cleanupPending ? '正在释放启动场景' : '当前设备不适合播放启动场景'
        } else {
          existing.title = '重播启动画面'
        }
        return true
      }
      var showBox = document.getElementById('rightside-config-show')
      if (!showBox) return false
      var button = document.createElement('button')
      button.id = BUTTON_ID
      button.type = 'button'
      button.title = '重播启动画面'
      button.setAttribute('aria-label', '重播天空之门启动画面')
      button.innerHTML = '<i class="fas fa-door-open" aria-hidden="true"></i>'
      button.addEventListener('click', function () {
        document.dispatchEvent(new window.CustomEvent(REPLAY_EVENT, { detail: { trigger: button } }))
      })
      var goUp = document.getElementById('go-up')
      if (goUp) showBox.insertBefore(button, goUp)
      else showBox.appendChild(button)
      var replayEligibility = getEligibility('replay')
      button.disabled = cleanupPending > 0 || replayDisabled || !replayEligibility.eligible
      if (button.disabled) {
        button.title = replayDisabled ? '启动场景本次加载失败' : cleanupPending ? '正在释放启动场景' : '当前设备不适合播放启动场景'
      }
      return true
    }

    function bindGlobalListeners () {
      if (listenersBound) return
      listenersBound = true
      document.addEventListener(REPLAY_EVENT, function (event) {
        start('replay', event.detail && event.detail.trigger)
      })
      document.addEventListener('pjax:send', function () { finalize('navigation') })
      document.addEventListener('pjax:complete', function () {
        injectReplayButton()
        start('auto')
      })
    }

    function bootstrap () {
      bindGlobalListeners()
      var ready = function () {
        injectReplayButton()
      }
      if (document.readyState === 'loading') {
        start('auto')
        document.addEventListener('DOMContentLoaded', ready, { once: true })
      } else {
        ready()
        start('auto')
      }
    }

    function destroy () {
      finalize('navigation')
    }

    return {
      bootstrap: bootstrap,
      start: start,
      finalize: finalize,
      injectReplayButton: injectReplayButton,
      getEligibility: getEligibility,
      getState: function () {
        return current
          ? { active: true, generation: current.generation, finalized: current.finalized, source: current.source }
          : { active: false }
      },
      getDebugState: function () {
        if (!current) return { active: false }
        var runtime = null
        if (current.handle && typeof current.handle.getDebugState === 'function') {
          try { runtime = current.handle.getDebugState() } catch (_) {}
        }
        return {
          active: true,
          generation: current.generation,
          source: current.source,
          runtime: runtime
        }
      },
      destroy: destroy
    }
  }

  return {
    SESSION_KEY: SESSION_KEY,
    COMPLETE_EVENT: COMPLETE_EVENT,
    REPLAY_EVENT: REPLAY_EVENT,
    MANIFEST_URL: MANIFEST_URL,
    parseBool: parseBool,
    isHomePath: isHomePath,
    evaluateEligibility: evaluateEligibility,
    readSeen: readSeen,
    markSeen: markSeen,
    validateManifest: validateManifest,
    createCoordinator: createCoordinator
  }
})
