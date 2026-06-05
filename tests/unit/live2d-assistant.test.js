import { describe, it, expect, beforeEach, afterEach } from 'vitest'

function loadModule () {
  const modulePath = require.resolve('../../source/js/live2d-assistant.js')
  delete require.cache[modulePath]
  return require(modulePath)
}

function installMemoryLocalStorage () {
  const store = new Map()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem (key) {
        return store.has(key) ? store.get(key) : null
      },
      setItem (key, value) {
        store.set(key, String(value))
      },
      removeItem (key) {
        store.delete(key)
      },
      clear () {
        store.clear()
      }
    }
  })
}

function eventWithProps (type, props) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.entries(props || {}).forEach(([key, value]) => {
    Object.defineProperty(event, key, {
      configurable: true,
      value
    })
  })
  return event
}

function setupDOM () {
  if (!window.localStorage || typeof window.localStorage.setItem !== 'function') installMemoryLocalStorage()
  try { window.localStorage.clear() } catch (_) {}
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
    delete window.PIXI
    delete globalThis.fetch
  })

  it('reads defaults when meta tags are missing', () => {
    const { readConfigFromMeta } = loadModule()
    const config = readConfigFromMeta()

    expect(config.enabled).toBe(true)
    expect(config.tipsPath).toBe('/live2d-widget/waifu-tips-yurisa.json')
    expect(config.siteIndexPath).toBe('/search.xml')
    expect(config.blogIndexPath).toBe('/data/blog-content-index.json')
    expect(config.modelPath).toBe('/live2d-widget/models/aphrodite/fense.model3.json')
    expect(config.pixiPath).toContain('pixi.js@6.5.10')
    expect(config.pixiLive2dPath).toContain('pixi-live2d-display@0.4.0')
    expect(config.modelId).toBe(0)
    expect(config.tools).toContain('assistant')
    expect(config.tools).toContain('model')
    expect(config.tools).toContain('search')
    expect(config.tools).toContain('quit')
    expect(config.modelScale).toBe(2.4)
    expect(config.modelX).toBe(0)
    expect(config.modelY).toBe(135)
    expect(config.position).toBe('right')
    expect(config.right).toBe('92px')
    expect(config.bottom).toBe('8px')
  })

  it('reads configured meta values', () => {
    document.head.innerHTML = `
      <meta name="live2d-enabled" content="false">
      <meta name="live2d-debug" content="true">
      <meta name="live2d-tips-path" content="/custom/tips.json">
      <meta name="live2d-site-index-path" content="/custom/search.xml">
      <meta name="live2d-blog-index-path" content="/custom/blog-index.json">
      <meta name="live2d-model-path" content="/custom/model.model3.json">
      <meta name="live2d-cdn-path" content="https://example.com/models">
      <meta name="live2d-pixi-path" content="/vendor/pixi.js">
      <meta name="live2d-pixi-live2d-path" content="/vendor/cubism4.js">
      <meta name="live2d-model-id" content="2">
      <meta name="live2d-tools" content="info,quit">
      <meta name="live2d-position" content="left">
      <meta name="live2d-left" content="32px">
      <meta name="live2d-bottom" content="12px">
      <meta name="live2d-model-scale" content="1.4">
      <meta name="live2d-model-x" content="12">
      <meta name="live2d-model-y" content="-18">
    `

    const { readConfigFromMeta } = loadModule()
    const config = readConfigFromMeta()

    expect(config.enabled).toBe(false)
    expect(config.debug).toBe(true)
    expect(config.tipsPath).toBe('/custom/tips.json')
    expect(config.siteIndexPath).toBe('/custom/search.xml')
    expect(config.blogIndexPath).toBe('/custom/blog-index.json')
    expect(config.modelPath).toBe('/custom/model.model3.json')
    expect(config.cdnPath).toBe('https://example.com/models')
    expect(config.pixiPath).toBe('/vendor/pixi.js')
    expect(config.pixiLive2dPath).toBe('/vendor/cubism4.js')
    expect(config.modelId).toBe(2)
    expect(config.tools).toEqual(['info', 'quit'])
    expect(config.position).toBe('left')
    expect(config.left).toBe('32px')
    expect(config.bottom).toBe('12px')
    expect(config.modelScale).toBe(1.4)
    expect(config.modelX).toBe(12)
    expect(config.modelY).toBe(-18)
  })

  it('keeps an explicitly empty cdn path for local models', () => {
    document.head.innerHTML = '<meta name="live2d-cdn-path" content="">'

    const { readConfigFromMeta } = loadModule()
    const config = readConfigFromMeta()

    expect(config.cdnPath).toBe('')
  })

  it('parses search XML and normalizes protocol-relative post URLs', () => {
    const { parseSearchXml } = loadModule()
    const entries = parseSearchXml(`
      <search>
        <entry>
          <title>测试文章</title>
          <url>//2026/06/03/test/</url>
          <content><![CDATA[动画 音乐 技术]]></content>
        </entry>
      </search>
    `)

    expect(entries).toEqual([
      { title: '测试文章', url: '/2026/06/03/test/', content: '动画 音乐 技术' }
    ])
  })

  it('parses search JSON and normalizes post URLs', () => {
    const { parseSearchJson } = loadModule()
    const entries = parseSearchJson(JSON.stringify([
      { title: 'JSON 文章', url: '//2026/06/04/json/', content: 'AI MCP' }
    ]))

    expect(entries).toEqual([
      { title: 'JSON 文章', url: '/2026/06/04/json/', content: 'AI MCP' }
    ])
  })

  it('recommends posts with shared categories and tags first', () => {
    document.body.innerHTML = '<article id="post"><h1 id="article-title">当前文章</h1></article>'
    window.history.replaceState({}, '', '/2026/06/03/current/')
    const { getRecommendedEntries } = loadModule()
    const entries = [
      { title: '当前文章', url: '/2026/06/03/current/', categories: ['技术研究'], tags: ['AI'] },
      { title: '同分类同标签', url: '/2026/06/04/a/', categories: ['技术研究'], tags: ['AI', 'MCP'] },
      { title: '不同主题', url: '/2026/06/04/b/', categories: ['音乐札记'], tags: ['罗大佑'] }
    ]

    expect(getRecommendedEntries(entries, 2).map((entry) => entry.title)).toEqual(['同分类同标签', '不同主题'])
  })
})

describe('live2d-assistant DOM helpers', () => {
  beforeEach(() => {
    setupDOM()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    delete window.__live2dAssistant
    delete window.PIXI
    delete globalThis.fetch
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
    const originalLocalStorage = window.localStorage
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

    try {
      expect(() => show()).not.toThrow()
      expect(document.getElementById('waifu').classList.contains('waifu-hidden')).toBe(false)
    } finally {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: originalLocalStorage
      })
    }
  })

  it('shows the restore toggle when the waifu is hidden and hides it after showing', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <button id="waifu-toggle" type="button"></button>
      <div id="waifu" class="waifu-active"></div>
    `)
    const { hide, show } = loadModule()

    hide()

    let toggle = document.getElementById('waifu-toggle')
    expect(document.getElementById('waifu').classList.contains('waifu-hidden')).toBe(true)
    expect(toggle.classList.contains('waifu-toggle-visible')).toBe(true)
    expect(toggle.getAttribute('aria-hidden')).toBe('false')
    expect(toggle.tabIndex).toBe(0)

    show()

    toggle = document.getElementById('waifu-toggle')
    expect(document.getElementById('waifu').classList.contains('waifu-hidden')).toBe(false)
    expect(toggle.classList.contains('waifu-toggle-visible')).toBe(false)
    expect(toggle.getAttribute('aria-hidden')).toBe('true')
    expect(toggle.tabIndex).toBe(-1)
  })

  it('applies configured placement and clears drag offsets', () => {
    document.head.innerHTML = `
      <meta name="live2d-position" content="right">
      <meta name="live2d-right" content="96px">
      <meta name="live2d-bottom" content="8px">
    `
    document.body.insertAdjacentHTML('beforeend', '<div id="waifu" style="left: 400px; top: 120px;"></div>')
    window.localStorage.setItem('live2d_widget_placement', JSON.stringify({ left: 123, bottom: 45 }))
    const { applyPlacement, resetPlacement } = loadModule()

    expect(applyPlacement()).toBe(true)

    let waifu = document.getElementById('waifu')
    expect(waifu.dataset.live2dPlacement).toBe('custom')
    expect(waifu.style.left).toBe('123px')
    expect(waifu.style.bottom).toBe('45px')

    expect(resetPlacement()).toBe(true)

    waifu = document.getElementById('waifu')
    expect(waifu.dataset.live2dPlacement).toBe('right')
    expect(waifu.style.left).toBe('auto')
    expect(waifu.style.right).toBe('96px')
    expect(waifu.style.top).toBe('auto')
    expect(waifu.style.bottom).toBe('8px')
  })

  it('uses configured placement when there is no saved widget position', () => {
    document.head.innerHTML = `
      <meta name="live2d-position" content="right">
      <meta name="live2d-right" content="96px">
      <meta name="live2d-bottom" content="8px">
    `
    document.body.insertAdjacentHTML('beforeend', '<div id="waifu" style="left: 400px; top: 120px;"></div>')
    const { resetPlacement } = loadModule()

    expect(resetPlacement()).toBe(true)

    const waifu = document.getElementById('waifu')
    expect(waifu.dataset.live2dPlacement).toBe('right')
    expect(waifu.style.left).toBe('auto')
    expect(waifu.style.right).toBe('96px')
    expect(waifu.style.top).toBe('auto')
    expect(waifu.style.bottom).toBe('8px')
  })

  it('opens a functional assistant panel with site actions', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="waifu">
        <div id="waifu-tips"></div>
        <div id="waifu-panel" hidden></div>
        <div id="waifu-canvas"></div>
        <div id="waifu-tool"></div>
      </div>
      <div class="recent-post-item"><a class="article-title" href="/posts/a/">第一篇</a></div>
    `)
    const { openAssistantPanel } = loadModule()
    globalThis.fetch = () => Promise.reject(new Error('offline'))

    expect(openAssistantPanel('home')).toBe(true)

    const panel = document.getElementById('waifu-panel')
    expect(panel.hidden).toBe(false)
    expect(panel.textContent).toContain('Yurisa Navigator')
    expect(panel.textContent).toContain('第一篇')
    expect(panel.querySelector('[data-waifu-action="music"]')).not.toBeNull()
    expect(panel.querySelector('[data-waifu-action="model"]')).not.toBeNull()
    expect(panel.querySelector('[data-waifu-action="recommend"]')).not.toBeNull()
    expect(panel.querySelector('[data-waifu-action="reading"]')).not.toBeNull()
    expect(panel.querySelector('#waifu-search-input')).not.toBeNull()
  })

  it('opens recommendation panel from current post context', async () => {
    document.body.innerHTML = `
      <article id="post">
        <h1 id="article-title">当前文章</h1>
      </article>
      <div id="waifu">
        <div id="waifu-tips"></div>
        <div id="waifu-panel" hidden></div>
        <div id="waifu-canvas"></div>
        <div id="waifu-tool"></div>
      </div>
    `
    window.history.replaceState({}, '', '/2026/06/03/current/')
    const { openAssistantPanel } = loadModule()
    globalThis.fetch = () => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('<search><entry><title>当前文章</title><url>/2026/06/03/current/</url><content>AI</content></entry><entry><title>下一篇</title><url>/2026/06/04/next/</url><content>AI MCP</content></entry></search>'),
      json: () => Promise.resolve({
        posts: [
          { title: '当前文章', url: '/2026/06/03/current/', categories: ['技术研究'], tags: ['AI'], description: '' },
          { title: '下一篇', url: '/2026/06/04/next/', categories: ['技术研究'], tags: ['AI', 'MCP'], description: '' }
        ]
      })
    })

    expect(openAssistantPanel('recommend')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const panel = document.getElementById('waifu-panel')
    expect(panel.hidden).toBe(false)
    expect(panel.textContent).toContain('推荐下一篇')
    expect(panel.textContent).toContain('下一篇')
    expect(panel.querySelector('[data-waifu-action="go-recommend"]')).not.toBeNull()
  })

  it('opens model controls and exposes scale/x/y presets', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="waifu">
        <div id="waifu-tips"></div>
        <div id="waifu-panel" hidden></div>
        <div id="waifu-canvas"></div>
        <div id="waifu-tool"></div>
      </div>
    `)
    const { openAssistantPanel } = loadModule()
    globalThis.fetch = () => Promise.reject(new Error('offline'))

    expect(openAssistantPanel('model')).toBe(true)

    const panel = document.getElementById('waifu-panel')
    const scale = panel.querySelector('[data-waifu-model-field="scale"]')
    expect(scale).not.toBeNull()
    expect(scale.getAttribute('min')).toBe('0.3')
    expect(scale.getAttribute('max')).toBe('3')
    expect(panel.querySelector('[data-waifu-model-field="x"]')).not.toBeNull()
    expect(panel.querySelector('[data-waifu-model-field="y"]')).not.toBeNull()
    expect(scale.value).toBe('2.4')
    expect(panel.querySelector('[data-waifu-model-field="x"]').value).toBe('0')
    expect(panel.querySelector('[data-waifu-model-field="y"]').value).toBe('135')
    expect(panel.querySelector('[data-waifu-preset="half"]')).not.toBeNull()
    expect(panel.querySelector('[data-waifu-placement-reset]')).not.toBeNull()
  })

  it('initializes a Pixi renderer when WebGL and libraries are available', async () => {
    Object.defineProperty(window, 'WebGLRenderingContext', {
      configurable: true,
      value: function WebGLRenderingContext () {}
    })
    HTMLCanvasElement.prototype.getContext = () => ({})
    globalThis.fetch = () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ message: { default: ['hello'] } }),
      text: () => Promise.resolve('<search><entry><title>第一篇</title><url>/posts/a/</url><content>技术 音乐</content></entry></search>')
    })
    const { init } = loadModule()

    const originalAppendChild = document.head.appendChild.bind(document.head)
    document.head.appendChild = (element) => {
      const result = originalAppendChild(element)
      if (element.tagName === 'LINK' || element.tagName === 'SCRIPT') {
        setTimeout(() => element.onload && element.onload())
      }
      return result
    }
    window.PIXI = {
      Application: function Application () {
        this.stage = { addChild: () => {} }
        this.ticker = {}
        this.view = document.createElement('canvas')
        this.destroy = () => {}
      },
      live2d: {
        Live2DModel: {
          from: () => Promise.resolve({
            width: 100,
            height: 100,
            x: 0,
            y: 0,
            anchor: { set: () => {} },
            scale: { set: () => {} },
            destroy: () => {},
            internalModel: { motionManager: { definitions: { Idle: [{ File: 'idle.motion3.json' }] } } }
          })
        }
      }
    }

    await init()

    const debug = window.__live2dAssistant.debug()
    expect(debug.initialized).toBe(true)
    expect(debug.status).toBe('visible')
    expect(debug.renderer.engine).toBe('pixi-live2d-display')
    expect(document.getElementById('waifu')).not.toBeNull()
    expect(document.getElementById('waifu-bubble')).not.toBeNull()
    expect(document.getElementById('waifu-bubble').hidden).toBe(false)
    expect(document.getElementById('waifu-bubble').textContent).toContain('Yurisa Chan')
    expect(document.getElementById('waifu-actionbar')).not.toBeNull()
    expect(document.querySelector('[data-waifu-actionbar-action="search"]')).not.toBeNull()
    expect(document.querySelector('[data-waifu-actionbar-action="random"]')).not.toBeNull()
    expect(document.querySelector('[data-waifu-actionbar-action="model"]')).not.toBeNull()
    expect(document.querySelector('[data-waifu-actionbar-action="quit"]')).not.toBeNull()

    const canvas = document.getElementById('waifu-canvas')
    const actionbar = document.getElementById('waifu-actionbar')
    const actionbarButtons = Array.from(actionbar.querySelectorAll('button'))
    expect(actionbar.getAttribute('aria-hidden')).toBe('true')
    expect(actionbarButtons.every((button) => button.tabIndex === -1)).toBe(true)

    canvas.dispatchEvent(new Event('mouseenter'))

    expect(actionbar.getAttribute('aria-hidden')).toBe('false')
    expect(actionbarButtons.every((button) => button.tabIndex === 0)).toBe(true)

    canvas.dispatchEvent(eventWithProps('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10 }))
    canvas.dispatchEvent(eventWithProps('pointerup', { pointerId: 1, clientX: 10, clientY: 10 }))

    expect(document.getElementById('waifu-bubble').hidden).toBe(true)

    canvas.dispatchEvent(eventWithProps('pointerdown', { button: 0, pointerId: 2, clientX: 10, clientY: 10 }))
    canvas.dispatchEvent(eventWithProps('pointerup', { pointerId: 2, clientX: 10, clientY: 10 }))

    expect(document.getElementById('waifu-bubble').hidden).toBe(false)

    document.querySelector('[data-waifu-actionbar-action="model"]').click()

    expect(document.getElementById('waifu-bubble').hidden).toBe(true)
    expect(document.getElementById('waifu-panel').hidden).toBe(false)
    expect(document.getElementById('waifu-panel').textContent).toContain('模型视窗')
  })

  it('keeps local model mode when cdn path is empty', async () => {
    document.head.innerHTML = '<meta name="live2d-cdn-path" content="">'
    const { readConfigFromMeta } = loadModule()
    const config = readConfigFromMeta()

    expect(config.cdnPath).toBe('')
    expect(config.modelPath).toBe('/live2d-widget/models/aphrodite/fense.model3.json')
  })

  it('disables the assistant without injecting UI when WebGL is unavailable', async () => {
    Object.defineProperty(window, 'WebGLRenderingContext', {
      configurable: true,
      value: undefined
    })
    const { init } = loadModule()

    await init()

    expect(document.getElementById('live2d-assistant-btn')).toBeNull()
    expect(window.__live2dAssistant.debug().status).toBe('webgl-disabled')
  })
})
