import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function loadModule () {
  const modulePath = require.resolve('../../source/js/genshin-launch.js')
  delete require.cache[modulePath]
  return require(modulePath)
}

function memoryStorage () {
  const values = new Map()
  return {
    getItem: vi.fn((key) => values.has(key) ? values.get(key) : null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key))
  }
}

function setupDom (enabled = true) {
  document.documentElement.removeAttribute('data-launch-state')
  document.documentElement.className = ''
  document.head.innerHTML = `<meta name="yurisa-launch-enabled" content="${enabled}">`
  document.body.innerHTML = `
    <div id="body-wrap"><h1 id="site-title">Yurisachan</h1></div>
    <div id="rightside"><div id="rightside-config-show"><button id="go-up" type="button"></button></div></div>
  `
  window.history.replaceState({}, '', '/')
}

function runtimeHarness (overrides = {}) {
  const storage = overrides.storage || memoryStorage()
  const handle = overrides.handle || { dispose: vi.fn(), pause: vi.fn(), resize: vi.fn() }
  const mountLaunchExperience = vi.fn(() => Promise.resolve(handle))
  const fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      version: 'test-v1',
      entry: '/assets/launch/assets/entry.test.js',
      dracoDecoderPath: '/assets/launch/assets/draco/',
      requiredAssetIds: ['model.door'],
      assets: { 'model.door': { critical: true } }
    })
  }))
  const importModule = vi.fn(() => Promise.resolve({ mountLaunchExperience }))
  let nextFrameId = 0
  const requestAnimationFrame = vi.fn((callback) => {
    const id = ++nextFrameId
    callback(performance.now())
    return id
  })
  const { createCoordinator } = loadModule()
  const coordinator = createCoordinator({
    document,
    location: window.location,
    navigator: window.navigator,
    storage,
    webgl2: true,
    fetch,
    importModule,
    requestAnimationFrame,
    cancelAnimationFrame: vi.fn(),
    ...overrides
  })
  return { coordinator, storage, handle, fetch, importModule, mountLaunchExperience }
}

function controlledFrames () {
  let nextId = 0
  const callbacks = new Map()
  return {
    requestAnimationFrame: vi.fn((callback) => {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    }),
    cancelAnimationFrame: vi.fn((id) => callbacks.delete(id)),
    flush () {
      const current = [...callbacks.values()]
      callbacks.clear()
      current.forEach(callback => callback(performance.now()))
    },
    get pending () { return callbacks.size }
  }
}

async function flushRuntime () {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function flushMicrotasks (turns = 12) {
  for (let index = 0; index < turns; index += 1) await Promise.resolve()
}

describe('genshin launch eligibility', () => {
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

  it.each([
    [{ launchParam: 'off', source: 'replay' }, 'off'],
    [{ location: { pathname: '/about/', search: '' }, source: 'replay' }, 'not-home'],
    [{ reducedMotion: true, launchParam: 'preview' }, 'reduced-motion'],
    [{ saveData: true, launchParam: 'preview' }, 'save-data'],
    [{ webgl2: false, source: 'replay' }, 'no-webgl2'],
    [{ enabled: false }, 'disabled'],
    [{ seenResult: { ok: true, seen: true } }, 'seen'],
    [{ seenResult: { ok: false, seen: false } }, 'storage-unavailable']
  ])('rejects %o as %s', (patch, reason) => {
    const { evaluateEligibility } = loadModule()
    expect(evaluateEligibility({ ...base, ...patch })).toMatchObject({ eligible: false, reason })
  })

  it('lets preview and replay override the disabled/seen gates only after safety gates', () => {
    const { evaluateEligibility } = loadModule()

    expect(evaluateEligibility({ ...base, enabled: false, launchParam: 'preview' })).toMatchObject({ eligible: true, mode: 'preview' })
    expect(evaluateEligibility({ ...base, enabled: false, seenResult: { ok: true, seen: true }, source: 'replay' })).toMatchObject({ eligible: true, mode: 'replay' })
  })

  it('marks the session safely and fails open when storage throws', () => {
    const { markSeen, readSeen, SESSION_KEY } = loadModule()
    const storage = memoryStorage()

    expect(markSeen(storage)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(SESSION_KEY, '1')
    expect(readSeen(storage)).toEqual({ ok: true, seen: true })

    const blocked = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') }
    }
    expect(readSeen(blocked)).toEqual({ ok: false, seen: false })
    expect(markSeen(blocked)).toBe(false)
  })
})

describe('genshin launch coordinator', () => {
  beforeEach(() => {
    setupDom(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete window.__live2dAssistant
    document.documentElement.removeAttribute('data-launch-state')
    document.documentElement.className = ''
    document.body.className = ''
    document.body.innerHTML = ''
  })

  it('mounts beside #body-wrap, marks seen before import, and finalizes exactly once', async () => {
    const complete = vi.fn()
    document.addEventListener('yurisa:launch-complete', complete)
    const harness = runtimeHarness()

    expect(harness.coordinator.start('auto')).toBe(true)
    expect(harness.storage.setItem).toHaveBeenCalledWith('yurisa_launch_seen_v1', '1')
    const host = document.querySelector('.yurisa-launch')
    const tools = host.querySelector('.yurisa-launch__tools')
    const toolControls = Array.from(tools.children)
    const credits = tools.querySelector('[data-launch-credits]')
    const primary = host.querySelector('[data-action="primary"]')
    expect(host.parentElement).toBe(document.body)
    expect(document.getElementById('body-wrap').hasAttribute('inert')).toBe(true)
    expect(tools.tagName).toBe('NAV')
    expect(toolControls.map(element => element.getAttribute('data-action') || (element.hasAttribute('data-launch-credits') ? 'credits' : null))).toEqual(['skip', 'mute', 'credits'])
    expect(toolControls.every(element => {
      const icon = element.querySelector('i')
      return icon?.getAttribute('aria-hidden') === 'true'
    })).toBe(true)
    expect(toolControls.map(element => element.getAttribute('aria-label')).every(Boolean)).toBe(true)
    expect(credits.getAttribute('target')).toBe('_blank')
    expect(credits.getAttribute('rel')).toContain('noopener')
    expect(primary.getAttribute('aria-label')).toBe('启动天空长廊')
    expect(primary.querySelector('i')?.getAttribute('aria-hidden')).toBe('true')
    expect(primary.querySelector('[data-launch-primary-surface]')).not.toBeNull()
    expect(host.querySelector('.yurisa-launch__brand-logo')).not.toBeNull()
    expect(host.querySelector('[data-launch-progress]').getAttribute('role')).toBe('progressbar')

    await flushRuntime()
    expect(harness.importModule).toHaveBeenCalledTimes(1)
    expect(harness.mountLaunchExperience).toHaveBeenCalledTimes(1)
    harness.mountLaunchExperience.mock.calls[0][0].onProgress({ value: 0.42, label: '正在构筑天空长廊' })
    expect(host.querySelector('[data-launch-progress]').style.getPropertyValue('--launch-progress')).toBe('42%')
    expect(host.querySelector('[data-launch-progress-value]').textContent).toBe('42%')
    expect(host.querySelector('.yurisa-launch__progress-fill').style.width).toBe('')
    expect(host.querySelector('[data-launch-status]').textContent).toBe('正在构筑天空长廊')

    expect(harness.coordinator.finalize('entered')).toBe(true)
    expect(harness.coordinator.finalize('skipped')).toBe(false)
    expect(document.querySelector('.yurisa-launch')).toBeNull()
    expect(document.getElementById('body-wrap').hasAttribute('inert')).toBe(false)
    await flushRuntime()
    expect(harness.handle.dispose).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][0].detail).toMatchObject({ outcome: 'entered' })
    document.removeEventListener('yurisa:launch-complete', complete)
  })

  it('resets the 10s stall watchdog on real progress while retaining the 30s total ceiling', async () => {
    vi.useFakeTimers()
    const complete = vi.fn()
    document.addEventListener('yurisa:launch-complete', complete)
    const harness = runtimeHarness()

    expect(harness.coordinator.start('auto')).toBe(true)
    await flushMicrotasks()
    const mountOptions = harness.mountLaunchExperience.mock.calls[0][0]

    for (const value of [0.2, 0.4, 0.6]) {
      vi.advanceTimersByTime(9_000)
      expect(harness.coordinator.getState()).toMatchObject({ active: true })
      mountOptions.onProgress({ value, label: '正在加载必需视觉资源' })
    }

    vi.advanceTimersByTime(2_999)
    expect(harness.coordinator.getState()).toMatchObject({ active: true })
    vi.advanceTimersByTime(1)
    expect(harness.coordinator.getState()).toEqual({ active: false })
    vi.runOnlyPendingTimers()
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][0].detail).toMatchObject({ outcome: 'fallback' })
    document.removeEventListener('yurisa:launch-complete', complete)
  })

  it('mounts as soon as body is parsed without waiting for DOMContentLoaded', async () => {
    document.body.remove()
    const harness = runtimeHarness()

    expect(document.body).toBeNull()
    expect(harness.coordinator.start('auto')).toBe(true)
    expect(harness.coordinator.getState()).toEqual({ active: false })

    const body = document.createElement('body')
    body.innerHTML = '<div id="body-wrap"><h1 id="site-title">Yurisachan</h1></div>'
    document.documentElement.appendChild(body)
    await Promise.resolve()

    expect(harness.coordinator.getState()).toMatchObject({ active: true, source: 'auto' })
    expect(document.querySelector('body > .yurisa-launch')).not.toBeNull()
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(harness.coordinator.finalize('skipped')).toBe(true)
    await flushRuntime()
  })

  it('locks body siblings parsed after an early mount and restores their original inert state', async () => {
    document.body.innerHTML = '<div id="loading-box"></div>'
    const harness = runtimeHarness()

    expect(harness.coordinator.start('auto')).toBe(true)
    const bodyWrap = document.createElement('div')
    bodyWrap.id = 'body-wrap'
    bodyWrap.innerHTML = '<h1 id="site-title">Yurisachan</h1>'
    const preInert = document.createElement('div')
    preInert.id = 'pre-inert'
    preInert.setAttribute('inert', '')
    document.documentElement.dataset.launchState = 'ready'
    document.body.append(bodyWrap, preInert)
    await flushMicrotasks()

    expect(bodyWrap.hasAttribute('inert')).toBe(true)
    expect(preInert.hasAttribute('inert')).toBe(true)
    expect(document.documentElement.dataset.launchState).toBe('ready')
    expect(harness.coordinator.finalize('skipped')).toBe(true)
    expect(bodyWrap.hasAttribute('inert')).toBe(false)
    expect(preInert.hasAttribute('inert')).toBe(true)
    expect(document.getElementById('loading-box').hasAttribute('inert')).toBe(false)
    await flushRuntime()
  })

  it('keeps the two-second fail-open deadline when body never appears', async () => {
    vi.useFakeTimers()
    document.body.remove()
    const harness = runtimeHarness()

    expect(harness.coordinator.start('auto')).toBe(true)
    vi.advanceTimersByTime(2_000)
    const body = document.createElement('body')
    document.documentElement.appendChild(body)
    await Promise.resolve()

    expect(harness.coordinator.getState()).toEqual({ active: false })
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(document.documentElement.hasAttribute('data-launch-state')).toBe(false)
  })

  it('suspends active Live2D before an initial auto mount and restores it on finalize', async () => {
    const storage = memoryStorage()
    const suspendForLaunch = vi.fn(() => {
      expect(document.querySelector('.yurisa-launch')).toBeNull()
      expect(storage.setItem).not.toHaveBeenCalled()
      return true
    })
    const resumeFromLaunch = vi.fn(() => Promise.resolve(true))
    window.__live2dAssistant = { suspendForLaunch, resumeFromLaunch }
    const harness = runtimeHarness({ storage })

    expect(harness.coordinator.start('auto')).toBe(true)
    expect(suspendForLaunch).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledWith('yurisa_launch_seen_v1', '1')
    await flushRuntime()

    expect(harness.coordinator.finalize('entered')).toBe(true)
    await flushRuntime()
    expect(resumeFromLaunch).toHaveBeenCalledTimes(1)
    expect(document.querySelector('.yurisa-launch')).toBeNull()
  })

  it('unlocks the page before abort listeners or GPU disposal can run', async () => {
    const order = []
    const onComplete = () => {
      order.push('complete')
      expect(document.querySelector('.yurisa-launch')).toBeNull()
      expect(document.getElementById('body-wrap').hasAttribute('inert')).toBe(false)
    }
    document.addEventListener('yurisa:launch-complete', onComplete)
    const handle = {
      pause: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(() => {
        order.push('dispose')
        expect(document.querySelector('.yurisa-launch')).toBeNull()
        expect(document.getElementById('body-wrap').hasAttribute('inert')).toBe(false)
      })
    }
    const harness = runtimeHarness({ handle })

    harness.coordinator.start('auto')
    await flushRuntime()
    const mountOptions = harness.mountLaunchExperience.mock.calls[0][0]
    mountOptions.signal.addEventListener('abort', () => {
      order.push('abort')
      expect(document.querySelector('.yurisa-launch')).toBeNull()
      expect(document.getElementById('body-wrap').hasAttribute('inert')).toBe(false)
    })

    harness.coordinator.finalize('skipped')

    await flushRuntime()
    expect(order).toEqual(['abort', 'dispose', 'complete'])
    document.removeEventListener('yurisa:launch-complete', onComplete)
  })

  it('pauses and unlocks synchronously, then cleans up in a task after two frames', async () => {
    const frames = controlledFrames()
    const order = []
    const handle = {
      pause: vi.fn(() => {
        order.push('pause')
        expect(document.querySelector('.yurisa-launch')).not.toBeNull()
        expect(document.getElementById('body-wrap').hasAttribute('inert')).toBe(true)
      }),
      resize: vi.fn(),
      dispose: vi.fn(() => order.push('dispose'))
    }
    const complete = vi.fn(() => {
      order.push('complete')
      expect(document.querySelector('.yurisa-launch')).toBeNull()
      expect(document.getElementById('body-wrap').hasAttribute('inert')).toBe(false)
    })
    document.addEventListener('yurisa:launch-complete', complete)
    const harness = runtimeHarness({
      handle,
      requestAnimationFrame: frames.requestAnimationFrame,
      cancelAnimationFrame: frames.cancelAnimationFrame
    })

    harness.coordinator.start('auto')
    await flushRuntime()
    expect(harness.coordinator.finalize('skipped')).toBe(true)
    expect(order).toEqual(['pause'])
    expect(harness.coordinator.start('replay')).toBe(false)
    expect(document.getElementById('genshin-launch-replay-btn').disabled).toBe(true)

    frames.flush()
    expect(order).toEqual(['pause'])
    frames.flush()
    expect(order).toEqual(['pause'])
    await flushRuntime()
    expect(order).toEqual(['pause', 'dispose', 'complete'])
    expect(complete).toHaveBeenCalledTimes(1)
    expect(document.getElementById('genshin-launch-replay-btn').disabled).toBe(false)
    expect(harness.coordinator.finalize('skipped')).toBe(false)
    frames.flush()
    expect(handle.dispose).toHaveBeenCalledTimes(1)
    document.removeEventListener('yurisa:launch-complete', complete)
  })

  it('uses the one-second cleanup fallback when animation frames stall', async () => {
    vi.useFakeTimers()
    const frames = controlledFrames()
    const complete = vi.fn()
    document.addEventListener('yurisa:launch-complete', complete)
    const harness = runtimeHarness({
      requestAnimationFrame: frames.requestAnimationFrame,
      cancelAnimationFrame: frames.cancelAnimationFrame
    })

    harness.coordinator.start('auto')
    await flushMicrotasks()
    harness.coordinator.finalize('skipped')
    vi.advanceTimersByTime(999)
    expect(harness.handle.dispose).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(harness.handle.dispose).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(1)
    frames.flush()
    frames.flush()
    expect(harness.handle.dispose).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(1)
    document.removeEventListener('yurisa:launch-complete', complete)
  })

  it('supports Escape immediately and reveals the complete utility dock only after two seconds', () => {
    vi.useFakeTimers()
    const harness = runtimeHarness()

    harness.coordinator.start('auto')
    const skip = document.querySelector('[data-action="skip"]')
    const tools = document.querySelector('.yurisa-launch__tools')
    expect(skip.hidden).toBe(true)
    expect(tools.getAttribute('aria-hidden')).toBe('true')
    expect(tools.hasAttribute('inert')).toBe(true)
    vi.advanceTimersByTime(1999)
    expect(skip.hidden).toBe(true)
    expect(tools.getAttribute('aria-hidden')).toBe('true')
    expect(tools.hasAttribute('inert')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(skip.hidden).toBe(false)
    expect(tools.getAttribute('aria-hidden')).toBe('false')
    expect(tools.hasAttribute('inert')).toBe(false)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(harness.coordinator.getState()).toEqual({ active: false })
    expect(document.querySelector('.yurisa-launch')).toBeNull()
  })

  it('does not request the manifest on ineligible visits and restores Live2D after a failed seen write', () => {
    document.head.innerHTML = '<meta name="yurisa-launch-enabled" content="false">'
    let harness = runtimeHarness()
    expect(harness.coordinator.start('auto')).toBe(false)
    expect(harness.fetch).not.toHaveBeenCalled()

    document.head.innerHTML = '<meta name="yurisa-launch-enabled" content="true">'
    const suspendForLaunch = vi.fn(() => true)
    const resumeFromLaunch = vi.fn(() => Promise.resolve(true))
    window.__live2dAssistant = { suspendForLaunch, resumeFromLaunch }
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error('blocked') })
    }
    harness = runtimeHarness({ storage })
    expect(harness.coordinator.start('auto')).toBe(false)
    expect(suspendForLaunch).toHaveBeenCalledTimes(1)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(resumeFromLaunch).toHaveBeenCalledTimes(1)
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(document.querySelector('.yurisa-launch')).toBeNull()
    expect(document.documentElement.hasAttribute('data-launch-state')).toBe(false)
  })

  it('disposes a runtime handle that resolves after the generation was skipped', async () => {
    const frames = controlledFrames()
    let resolveMount
    const lateHandle = { pause: vi.fn(), dispose: vi.fn() }
    const mountLaunchExperience = vi.fn(() => new Promise((resolve) => { resolveMount = resolve }))
    const harness = runtimeHarness({
      importModule: () => Promise.resolve({ mountLaunchExperience }),
      requestAnimationFrame: frames.requestAnimationFrame,
      cancelAnimationFrame: frames.cancelAnimationFrame
    })

    harness.coordinator.start('auto')
    await flushRuntime()
    harness.coordinator.finalize('skipped')
    frames.flush()
    frames.flush()
    await flushRuntime()
    expect(lateHandle.dispose).not.toHaveBeenCalled()

    resolveMount(lateHandle)
    await flushMicrotasks()
    expect(lateHandle.pause).toHaveBeenCalledWith(true)
    expect(lateHandle.dispose).not.toHaveBeenCalled()
    expect(document.getElementById('genshin-launch-replay-btn').disabled).toBe(true)
    frames.flush()
    expect(lateHandle.dispose).not.toHaveBeenCalled()
    frames.flush()
    expect(lateHandle.dispose).not.toHaveBeenCalled()
    await flushRuntime()

    expect(lateHandle.dispose).toHaveBeenCalledTimes(1)
    expect(document.getElementById('genshin-launch-replay-btn').disabled).toBe(false)
    expect(harness.coordinator.getState()).toEqual({ active: false })
  })

  it('suspends Live2D for a PJAX homepage auto mount and a later replay', async () => {
    const suspendForLaunch = vi.fn(() => true)
    const resumeFromLaunch = vi.fn(() => Promise.resolve(true))
    window.__live2dAssistant = { suspendForLaunch, resumeFromLaunch }
    window.history.replaceState({}, '', '/about/')
    const storage = memoryStorage()
    const harness = runtimeHarness({ storage })
    harness.coordinator.bootstrap()

    expect(suspendForLaunch).not.toHaveBeenCalled()
    window.history.replaceState({}, '', '/')
    document.dispatchEvent(new Event('pjax:complete'))

    expect(harness.coordinator.getState()).toMatchObject({ active: true, source: 'auto' })
    expect(suspendForLaunch).toHaveBeenCalledTimes(1)
    await flushRuntime()
    expect(harness.coordinator.finalize('entered')).toBe(true)
    await flushRuntime()
    expect(resumeFromLaunch).toHaveBeenCalledTimes(1)

    expect(document.querySelectorAll('#genshin-launch-replay-btn')).toHaveLength(1)
    document.getElementById('genshin-launch-replay-btn').click()

    expect(suspendForLaunch).toHaveBeenCalledTimes(2)
    expect(harness.coordinator.getState()).toMatchObject({ active: true, source: 'replay' })
    expect(document.querySelector('.yurisa-launch')).not.toBeNull()
    await flushRuntime()
    expect(harness.coordinator.finalize('skipped')).toBe(true)
    await flushRuntime()
    expect(resumeFromLaunch).toHaveBeenCalledTimes(2)
  })

  it('unlocks synchronously and finalizes exactly once when PJAX navigates during launch', async () => {
    const frames = controlledFrames()
    const complete = vi.fn()
    document.addEventListener('yurisa:launch-complete', complete)
    const harness = runtimeHarness({
      requestAnimationFrame: frames.requestAnimationFrame,
      cancelAnimationFrame: frames.cancelAnimationFrame
    })
    harness.coordinator.bootstrap()
    await flushMicrotasks()

    expect(harness.coordinator.getState()).toMatchObject({ active: true, source: 'auto' })
    expect(document.querySelector('.yurisa-launch')).not.toBeNull()
    expect(document.getElementById('body-wrap').hasAttribute('inert')).toBe(true)

    document.dispatchEvent(new Event('pjax:send'))

    expect(harness.coordinator.getState()).toEqual({ active: false })
    expect(document.querySelector('.yurisa-launch')).toBeNull()
    expect(document.getElementById('body-wrap').hasAttribute('inert')).toBe(false)
    expect(complete).not.toHaveBeenCalled()

    document.dispatchEvent(new Event('pjax:complete'))
    expect(document.querySelector('.yurisa-launch')).toBeNull()
    expect(harness.coordinator.getState()).toEqual({ active: false })

    frames.flush()
    frames.flush()
    await flushRuntime()

    expect(harness.handle.dispose).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete.mock.calls[0][0].detail).toMatchObject({ outcome: 'navigation' })
    document.removeEventListener('yurisa:launch-complete', complete)
  })

  it('launches and finalizes without a Live2D assistant', async () => {
    delete window.__live2dAssistant
    const harness = runtimeHarness()

    expect(() => harness.coordinator.start('auto')).not.toThrow()
    expect(harness.coordinator.getState().active).toBe(true)
    await flushRuntime()
    expect(() => harness.coordinator.finalize('entered')).not.toThrow()
    await flushRuntime()
    expect(harness.coordinator.getState()).toEqual({ active: false })
  })

  it.each(['returns false', 'throws', 'suspend hook is missing', 'resume hook is missing'])('does not launch or mark seen when the Live2D lifecycle %s', (failure) => {
    const storage = memoryStorage()
    const resumeFromLaunch = failure === 'resume hook is missing' ? null : vi.fn(() => Promise.resolve(false))
    const assistant = {}
    if (resumeFromLaunch) assistant.resumeFromLaunch = resumeFromLaunch
    let suspendForLaunch
    if (failure === 'returns false') suspendForLaunch = vi.fn(() => false)
    if (failure === 'throws') suspendForLaunch = vi.fn(() => { throw new Error('suspend failed') })
    if (failure === 'resume hook is missing') suspendForLaunch = vi.fn(() => true)
    if (suspendForLaunch) assistant.suspendForLaunch = suspendForLaunch
    window.__live2dAssistant = assistant
    const harness = runtimeHarness({ storage })

    expect(harness.coordinator.start('auto')).toBe(false)
    if (suspendForLaunch) expect(suspendForLaunch).toHaveBeenCalledTimes(failure === 'resume hook is missing' ? 0 : 1)
    expect(storage.setItem).not.toHaveBeenCalled()
    if (resumeFromLaunch) expect(resumeFromLaunch).not.toHaveBeenCalled()
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.coordinator.getState()).toEqual({ active: false })
    expect(document.querySelector('.yurisa-launch')).toBeNull()
    expect(document.documentElement.hasAttribute('data-launch-state')).toBe(false)
  })

  it('does not start replay when active Live2D cannot be suspended', () => {
    const storage = memoryStorage()
    storage.setItem('yurisa_launch_seen_v1', '1')
    storage.setItem.mockClear()
    const suspendForLaunch = vi.fn(() => false)
    window.__live2dAssistant = {
      suspendForLaunch,
      resumeFromLaunch: vi.fn(() => Promise.resolve(false))
    }
    const harness = runtimeHarness({ storage })

    expect(harness.coordinator.start('replay')).toBe(false)
    expect(suspendForLaunch).toHaveBeenCalledTimes(1)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(document.querySelector('.yurisa-launch')).toBeNull()
    expect(document.documentElement.hasAttribute('data-launch-state')).toBe(false)
  })

  it('still finalizes when a successfully suspended assistant throws during resume', async () => {
    const suspendForLaunch = vi.fn(() => true)
    const resumeFromLaunch = vi.fn(() => { throw new Error('resume failed') })
    window.__live2dAssistant = { suspendForLaunch, resumeFromLaunch }
    const harness = runtimeHarness()

    expect(harness.coordinator.start('auto')).toBe(true)
    await flushRuntime()
    expect(() => harness.coordinator.finalize('fallback')).not.toThrow()
    await flushRuntime()
    expect(resumeFromLaunch).toHaveBeenCalledTimes(1)
    expect(harness.coordinator.getState()).toEqual({ active: false })
  })

  it('validates that the runtime entry is a same-origin launch asset', () => {
    const { validateManifest } = loadModule()
    const valid = {
      version: '1',
      entry: '/assets/launch/assets/a.js',
      requiredAssetIds: ['model.door'],
      assets: { 'model.door': { critical: true } }
    }
    expect(validateManifest(valid, window.location)).toContain('/assets/launch/assets/a.js')
    expect(() => validateManifest({ ...valid, entry: 'https://evil.example/a.js' }, window.location)).toThrow('Unsafe')
    expect(() => validateManifest({ version: '1', entry: '/assets/launch/a.js' }, window.location)).toThrow('assets')
    expect(() => validateManifest({ ...valid, requiredAssetIds: null }, window.location)).toThrow('required')
    expect(() => validateManifest({ ...valid, requiredAssetIds: ['model.road'] }, window.location)).toThrow('required')
    expect(() => validateManifest({ ...valid, assets: { 'model.door': { critical: false } } }, window.location)).toThrow('required')
  })
})
