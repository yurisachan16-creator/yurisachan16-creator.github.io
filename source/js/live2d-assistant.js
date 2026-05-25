/**
 * live2d-assistant.js — Live2D 看板娘桥接层
 * 使用本地 vendored live2d-widget dist，并补充博客内的配置、PJAX 重绑、rightside 开关和调试入口。
 */
;(function () {
  'use strict'

  var STORAGE_KEY = 'live2d_assistant_state'
  var BUTTON_ID = 'live2d-assistant-btn'
  var DEFAULT_CONFIG = {
    enabled: true,
    debug: false,
    widgetBase: '/live2d-widget/dist/',
    tipsPath: '/live2d-widget/waifu-tips-yurisa.json',
    cdnPath: 'https://fastly.jsdelivr.net/gh/fghrsh/live2d_api/',
    cubism5Path: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
    modelId: 0,
    tools: ['hitokoto', 'switch-model', 'switch-texture', 'photo', 'info', 'quit'],
    drag: true,
    showToggleAfterQuit: true,
    logLevel: 'warn',
    mobile: true
  }

  var state = {
    status: 'idle',
    initialized: false,
    loading: false,
    lastError: null,
    lastMessageAt: 0,
    articleBottomShown: false,
    events: []
  }

  function meta (name) {
    var el = document.querySelector('meta[name="' + name + '"]')
    return el ? el.content : ''
  }

  function parseBool (value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    var normalized = String(value).toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false
    return fallback
  }

  function normalizeBase (value) {
    if (!value) return DEFAULT_CONFIG.widgetBase
    return value.endsWith('/') ? value : value + '/'
  }

  function readConfigFromMeta () {
    var modelId = parseInt(meta('live2d-model-id'), 10)
    var tools = meta('live2d-tools')

    return {
      enabled: parseBool(meta('live2d-enabled'), DEFAULT_CONFIG.enabled),
      debug: parseBool(meta('live2d-debug'), DEFAULT_CONFIG.debug),
      widgetBase: normalizeBase(meta('live2d-widget-base')),
      tipsPath: meta('live2d-tips-path') || DEFAULT_CONFIG.tipsPath,
      cdnPath: normalizeBase(meta('live2d-cdn-path') || DEFAULT_CONFIG.cdnPath),
      cubism5Path: meta('live2d-cubism5-path') || DEFAULT_CONFIG.cubism5Path,
      modelId: isNaN(modelId) ? DEFAULT_CONFIG.modelId : modelId,
      tools: tools ? tools.split(',').map(function (item) { return item.trim() }).filter(Boolean) : DEFAULT_CONFIG.tools.slice(),
      drag: parseBool(meta('live2d-drag'), DEFAULT_CONFIG.drag),
      showToggleAfterQuit: parseBool(meta('live2d-show-toggle-after-quit'), DEFAULT_CONFIG.showToggleAfterQuit),
      logLevel: meta('live2d-log-level') || DEFAULT_CONFIG.logLevel,
      mobile: parseBool(meta('live2d-mobile'), DEFAULT_CONFIG.mobile)
    }
  }

  function pushEvent (key, data) {
    state.events.push({ key: key, at: Date.now(), data: data || null })
    if (state.events.length > 20) state.events.shift()
  }

  function setStatus (status) {
    state.status = status
    pushEvent('status:' + status)
  }

  function setError (code, error) {
    state.lastError = {
      code: code,
      message: error && error.message ? error.message : String(error || code),
      at: Date.now()
    }
    setStatus('error')
    if (window.console) console.warn('[Live2D Assistant]', code, error)
  }

  function saveState (patch) {
    var current = {}
    try {
      current = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(current, patch)))
    } catch (_) {}
  }

  function removeStorageItem (key) {
    try { localStorage.removeItem(key) } catch (_) {}
  }

  function loadCss (href) {
    if (document.querySelector('link[data-live2d-assistant-css="' + href + '"]')) return Promise.resolve(href)
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('link')
      tag.rel = 'stylesheet'
      tag.href = href
      tag.dataset.live2dAssistantCss = href
      tag.onload = function () { resolve(href) }
      tag.onerror = function () { reject(new Error('CSS load failed: ' + href)) }
      document.head.appendChild(tag)
    })
  }

  function loadModuleScript (src) {
    if (document.querySelector('script[data-live2d-assistant-module="' + src + '"]')) return Promise.resolve(src)
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script')
      tag.type = 'module'
      tag.src = src
      tag.dataset.live2dAssistantModule = src
      tag.onload = function () { resolve(src) }
      tag.onerror = function () { reject(new Error('Module load failed: ' + src)) }
      document.head.appendChild(tag)
    })
  }

  function hasWidgetDom () {
    return !!(document.getElementById('waifu') || document.getElementById('waifu-toggle'))
  }

  function say (text, priority) {
    var now = Date.now()
    if (!text || (priority || 0) < 9 && now - state.lastMessageAt < 8000) return false
    var tips = document.getElementById('waifu-tips')
    if (!tips) return false
    tips.textContent = text
    tips.classList.add('waifu-tips-active')
    state.lastMessageAt = now
    pushEvent('say', { text: text, priority: priority || 8 })
    setTimeout(function () {
      tips.classList.remove('waifu-tips-active')
    }, 4500)
    return true
  }

  function show () {
    removeStorageItem('waifu-disabled')
    removeStorageItem('waifu-display')
    var waifu = document.getElementById('waifu')
    if (waifu) {
      waifu.classList.remove('waifu-hidden')
      setTimeout(function () { waifu.classList.add('waifu-active') }, 0)
      setStatus('visible')
      saveState({ visible: true })
      return
    }
    init()
  }

  function hide () {
    var waifu = document.getElementById('waifu')
    if (waifu) {
      waifu.classList.remove('waifu-active')
      waifu.classList.add('waifu-hidden')
      setStatus('hidden')
      saveState({ visible: false })
    }
  }

  function toggle () {
    var waifu = document.getElementById('waifu')
    if (!waifu || waifu.classList.contains('waifu-hidden')) {
      show()
    } else {
      hide()
    }
  }

  function injectRightsideButton () {
    if (document.getElementById(BUTTON_ID)) return
    var showBox = document.getElementById('rightside-config-show')
    if (!showBox) return

    var btn = document.createElement('button')
    btn.id = BUTTON_ID
    btn.type = 'button'
    btn.title = '看板娘'
    btn.setAttribute('aria-label', '显示或隐藏看板娘')
    btn.innerHTML = '<i class="fas fa-child"></i>'
    btn.addEventListener('click', function () {
      pushEvent('button:toggle')
      toggle()
    })

    var musicBtn = document.getElementById('music-player-btn')
    var goUp = document.getElementById('go-up')
    if (musicBtn && musicBtn.nextSibling) {
      showBox.insertBefore(btn, musicBtn.nextSibling)
    } else if (goUp) {
      showBox.insertBefore(btn, goUp)
    } else {
      showBox.appendChild(btn)
    }
  }

  function bindBlogEvents () {
    if (state.boundBlogEvents) return
    state.boundBlogEvents = true

    document.addEventListener('click', function (event) {
      var target = event.target
      if (!target || !target.closest) return
      if (target.closest('#music-player-btn')) {
        setTimeout(function () { say('播放器打开啦，边读边听也不错。', 9) }, 200)
      } else if (target.closest('#music-play')) {
        setTimeout(function () { say('音乐准备好了，音量记得调舒服。', 9) }, 200)
      }
    })

    window.addEventListener('scroll', function () {
      if (state.articleBottomShown) return
      var article = document.querySelector('.post-content, #article-container, article')
      if (!article) return
      var rect = article.getBoundingClientRect()
      if (rect.bottom < window.innerHeight + 80) {
        state.articleBottomShown = true
        say('读到这里啦，要继续看下一篇吗？', 8)
      }
    }, { passive: true })

    document.addEventListener('pjax:complete', function () {
      state.articleBottomShown = false
      injectRightsideButton()
      pushEvent('pjax:complete')
    })
  }

  function getDebugState () {
    return {
      status: state.status,
      initialized: state.initialized,
      loading: state.loading,
      lastError: state.lastError,
      lastMessageAt: state.lastMessageAt,
      events: state.events.slice(),
      config: window.__live2dAssistant ? window.__live2dAssistant.config : null,
      dom: {
        waifu: !!document.getElementById('waifu'),
        tips: !!document.getElementById('waifu-tips'),
        button: !!document.getElementById(BUTTON_ID)
      }
    }
  }

  function init () {
    var config = readConfigFromMeta()
    window.__live2dAssistant = window.__live2dAssistant || {}
    window.__live2dAssistant.config = config

    if (!config.enabled) {
      setStatus('disabled')
      return Promise.resolve(false)
    }
    if (!config.mobile && window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      setStatus('mobile-disabled')
      return Promise.resolve(false)
    }

    injectRightsideButton()
    bindBlogEvents()
    if (state.initialized || state.loading) return Promise.resolve(true)

    state.loading = true
    setStatus('loading')

    return Promise.all([
      loadCss(config.widgetBase + 'waifu.css'),
      loadModuleScript(config.widgetBase + 'waifu-tips.js')
    ]).then(function () {
      if (typeof window.initWidget !== 'function') throw new Error('window.initWidget is not available')
      window.initWidget({
        waifuPath: config.tipsPath,
        cdnPath: config.cdnPath,
        cubism2Path: config.widgetBase + 'live2d.min.js',
        cubism5Path: config.cubism5Path,
        modelId: config.modelId,
        tools: config.tools,
        drag: config.drag,
        showToggleAfterQuit: config.showToggleAfterQuit,
        logLevel: config.logLevel
      })
      state.loading = false
      state.initialized = hasWidgetDom()
      setStatus(document.getElementById('waifu') ? 'visible' : (state.initialized ? 'hidden' : 'widget-disabled'))
      return true
    }).catch(function (error) {
      state.loading = false
      setError('INIT_FAILED', error)
      return false
    })
  }

  window.__live2dAssistant = {
    version: '0.1.0',
    init: init,
    show: show,
    hide: hide,
    toggle: toggle,
    say: say,
    injectRightsideButton: injectRightsideButton,
    readConfigFromMeta: readConfigFromMeta,
    debug: getDebugState,
    config: readConfigFromMeta()
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      DEFAULT_CONFIG: DEFAULT_CONFIG,
      init: init,
      show: show,
      readConfigFromMeta: readConfigFromMeta,
      injectRightsideButton: injectRightsideButton,
      getDebugState: getDebugState,
      say: say
    }
    return
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
