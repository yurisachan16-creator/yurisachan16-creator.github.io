import { describe, it, expect, beforeEach, afterEach } from 'vitest'

function loadModule () {
  const modulePath = require.resolve('../../source/js/live2d-assistant.js')
  delete require.cache[modulePath]
  return require(modulePath)
}

function setupDOM () {
  document.head.innerHTML = ''
  document.body.innerHTML = `
    <div id="rightside">
      <div id="rightside-config-show">
        <button id="music-player-btn" type="button"><i class="fas fa-music"></i></button>
        <button id="go-up" type="button"></button>
      </div>
    </div>
  `
}

describe('live2d-assistant config', () => {
  beforeEach(() => {
    setupDOM()
  })

  afterEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    delete window.__live2dAssistant
  })

  it('reads defaults when meta tags are missing', () => {
    const { readConfigFromMeta } = loadModule()
    const config = readConfigFromMeta()

    expect(config.enabled).toBe(true)
    expect(config.widgetBase).toBe('/live2d-widget/dist/')
    expect(config.tipsPath).toBe('/live2d-widget/waifu-tips-yurisa.json')
    expect(config.modelId).toBe(0)
    expect(config.tools).toContain('quit')
  })

  it('reads configured meta values', () => {
    document.head.innerHTML = `
      <meta name="live2d-enabled" content="false">
      <meta name="live2d-debug" content="true">
      <meta name="live2d-widget-base" content="/vendor/live2d">
      <meta name="live2d-tips-path" content="/custom/tips.json">
      <meta name="live2d-cdn-path" content="https://example.com/models">
      <meta name="live2d-model-id" content="2">
      <meta name="live2d-tools" content="info,quit">
    `

    const { readConfigFromMeta } = loadModule()
    const config = readConfigFromMeta()

    expect(config.enabled).toBe(false)
    expect(config.debug).toBe(true)
    expect(config.widgetBase).toBe('/vendor/live2d/')
    expect(config.tipsPath).toBe('/custom/tips.json')
    expect(config.cdnPath).toBe('https://example.com/models/')
    expect(config.modelId).toBe(2)
    expect(config.tools).toEqual(['info', 'quit'])
  })
})

describe('live2d-assistant DOM helpers', () => {
  beforeEach(() => {
    setupDOM()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    delete window.__live2dAssistant
  })

  it('injects a rightside button once', () => {
    const { injectRightsideButton } = loadModule()

    injectRightsideButton()
    injectRightsideButton()

    expect(document.querySelectorAll('#live2d-assistant-btn')).toHaveLength(1)
    expect(document.getElementById('live2d-assistant-btn').getAttribute('aria-label')).toBe('显示或隐藏看板娘')
  })

  it('does nothing when rightside container is missing', () => {
    document.body.innerHTML = ''
    const { injectRightsideButton } = loadModule()

    injectRightsideButton()

    expect(document.getElementById('live2d-assistant-btn')).toBeNull()
  })

  it('does not inject UI when disabled by config', async () => {
    document.head.innerHTML = '<meta name="live2d-enabled" content="false">'
    const { init } = loadModule()

    await init()

    expect(document.getElementById('live2d-assistant-btn')).toBeNull()
    expect(window.__live2dAssistant.debug().status).toBe('disabled')
  })

  it('show tolerates unavailable localStorage when waifu already exists', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="waifu" class="waifu-hidden"></div>')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        removeItem () {
          throw new Error('storage blocked')
        },
        getItem () {
          throw new Error('storage blocked')
        },
        setItem () {
          throw new Error('storage blocked')
        }
      }
    })

    const { show } = loadModule()

    expect(() => show()).not.toThrow()
    expect(document.getElementById('waifu').classList.contains('waifu-hidden')).toBe(false)
  })
})
