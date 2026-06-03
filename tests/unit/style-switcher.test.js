/**
 * 风格切换器单元测试
 * 测试 data-style 状态、localStorage 持久化、rightside 按钮注入与 PJAX 重绑。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function loadModule () {
  const modulePath = require.resolve('../../source/js/style-switcher.js')
  delete require.cache[modulePath]
  return require(modulePath)
}

function createStorageMock () {
  const store = {}

  return {
    getItem (key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    },
    setItem (key, value) {
      store[key] = String(value)
    },
    removeItem (key) {
      delete store[key]
    },
    clear () {
      Object.keys(store).forEach((key) => delete store[key])
    }
  }
}

function setupDOM () {
  const storage = createStorageMock()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  })

  document.documentElement.removeAttribute('data-style')
  window.history.replaceState({}, '', '/')
  document.body.innerHTML = `
    <div id="rightside">
      <div id="rightside-config-show">
        <button id="rightside-config" type="button"></button>
        <button id="music-player-btn" type="button"></button>
        <button id="go-up" type="button"></button>
      </div>
    </div>
  `

  return storage
}

function setupHomeDOM () {
  const storage = setupDOM()
  document.body.insertAdjacentHTML('afterbegin', `
    <header id="page-header">
      <div id="site-info">
        <h1 id="site-title">Yurisachan</h1>
        <div id="site-subtitle"><span id="subtitle"></span></div>
      </div>
    </header>
  `)
  return storage
}

describe('style-switcher', () => {
  let storage

  beforeEach(() => {
    storage = setupDOM()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    document.documentElement.removeAttribute('data-style')
    storage.clear()
  })

  it('falls back to pixel for invalid saved values', () => {
    storage.setItem('site_style_v1', 'unknown')
    const { readSavedStyle } = loadModule()

    expect(readSavedStyle()).toBe('pixel')
    expect(document.documentElement.dataset.style).toBe('pixel')
  })

  it('applies and persists a valid style', () => {
    const { applyStyle } = loadModule()

    const applied = applyStyle('vereis', true)

    expect(applied).toBe('vereis')
    expect(document.documentElement.dataset.style).toBe('vereis')
    expect(storage.getItem('site_style_v1')).toBe('vereis')
  })

  it('cycles through the supported styles', () => {
    const { nextStyle } = loadModule()

    expect(nextStyle('pixel')).toBe('vereis')
    expect(nextStyle('vereis')).toBe('pixel')
    expect(nextStyle('bad')).toBe('vereis')
  })

  it('injects the rightside button once before #go-up', () => {
    const { injectRightsideButton } = loadModule()

    injectRightsideButton()
    injectRightsideButton()

    const buttons = document.querySelectorAll('#style-switcher-btn')
    expect(buttons).toHaveLength(1)
    expect(document.getElementById('rightside-config-show').children[2].id).toBe('style-switcher-btn')
    expect(document.getElementById('rightside-config-show').children[3].id).toBe('go-up')
  })

  it('clicking the button toggles style and updates accessibility state', () => {
    loadModule()

    const btn = document.getElementById('style-switcher-btn')
    btn.click()

    expect(document.documentElement.dataset.style).toBe('vereis')
    expect(storage.getItem('site_style_v1')).toBe('vereis')
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.getAttribute('aria-label')).toContain('柔和手账风')
  })

  it('reinjects and rebinds the button after PJAX replaces rightside DOM', () => {
    storage.setItem('site_style_v1', 'vereis')
    loadModule()

    document.body.innerHTML = `
      <div id="rightside">
        <div id="rightside-config-show">
          <button id="rightside-config" type="button"></button>
          <button id="go-up" type="button"></button>
        </div>
      </div>
    `
    document.dispatchEvent(new Event('pjax:complete'))

    const btn = document.getElementById('style-switcher-btn')
    expect(btn).not.toBeNull()
    expect(document.documentElement.dataset.style).toBe('vereis')

    btn.click()
    expect(document.documentElement.dataset.style).toBe('pixel')
    expect(storage.getItem('site_style_v1')).toBe('pixel')
  })

  it('injects the Vereis home panel once on the homepage', () => {
    storage = setupHomeDOM()
    const { applyStyle, ensureHomePanel } = loadModule()

    applyStyle('vereis', true)
    ensureHomePanel()
    ensureHomePanel()

    const panels = document.querySelectorAll('#vereis-home-panel')
    expect(panels).toHaveLength(1)
    expect(panels[0].parentElement.id).toBe('site-info')
    expect(panels[0].hidden).toBe(false)
    expect(panels[0].getAttribute('aria-hidden')).toBe('false')
  })

  it('hides the home panel when switching back to pixel', () => {
    storage = setupHomeDOM()
    const { applyStyle } = loadModule()

    applyStyle('vereis', true)
    expect(document.getElementById('vereis-home-panel').hidden).toBe(false)

    applyStyle('pixel', true)
    expect(document.getElementById('vereis-home-panel').hidden).toBe(true)
    expect(document.getElementById('vereis-home-panel').getAttribute('aria-hidden')).toBe('true')
  })

  it('does not inject the home panel outside the homepage', () => {
    window.history.replaceState({}, '', '/about/')
    document.body.insertAdjacentHTML('afterbegin', `
      <header id="page-header">
        <div id="site-info"><h1 id="site-title">About</h1></div>
      </header>
    `)
    const { applyStyle, ensureHomePanel } = loadModule()

    applyStyle('vereis', true)

    expect(ensureHomePanel()).toBeNull()
    expect(document.getElementById('vereis-home-panel')).toBeNull()
  })

  it('recreates the home panel after PJAX replaces the homepage DOM', () => {
    storage = setupHomeDOM()
    storage.setItem('site_style_v1', 'vereis')
    loadModule()

    document.body.innerHTML = `
      <header id="page-header">
        <div id="site-info"><h1 id="site-title">Yurisachan</h1></div>
      </header>
      <div id="rightside">
        <div id="rightside-config-show">
          <button id="rightside-config" type="button"></button>
          <button id="go-up" type="button"></button>
        </div>
      </div>
    `
    document.dispatchEvent(new Event('pjax:complete'))

    const panels = document.querySelectorAll('#vereis-home-panel')
    expect(panels).toHaveLength(1)
    expect(panels[0].hidden).toBe(false)
    expect(document.getElementById('style-switcher-btn')).not.toBeNull()
  })
})
