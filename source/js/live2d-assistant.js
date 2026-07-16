/**
 * live2d-assistant.js - Live2D 看板娘桥接层
 * 使用 PixiJS + pixi-live2d-display 渲染 Cubism 3/4 模型，并保留博客侧配置、PJAX 重绑、rightside 开关和调试入口。
 */
;(function () {
  'use strict'

  var STORAGE_KEY = 'live2d_assistant_state'
  var MODEL_VIEW_STORAGE_KEY = 'live2d_model_view_v3'
  var WIDGET_PLACEMENT_STORAGE_KEY = 'live2d_widget_placement'
  var BUTTON_ID = 'live2d-assistant-btn'
  var DEFAULT_CONFIG = {
    enabled: true,
    debug: false,
    tipsPath: '/live2d-widget/waifu-tips-yurisa.json',
    siteIndexPath: '/search.xml',
    blogIndexPath: '/data/blog-content-index.json',
    modelPath: '/live2d-widget/models/aphrodite/fense.model3.json',
    cubism5Path: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
    pixiPath: 'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js',
    pixiLive2dPath: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js',
    modelId: 0,
    tools: ['assistant', 'model', 'search', 'random', 'progress', 'music', 'style', 'photo', 'quit'],
    drag: true,
    showToggleAfterQuit: true,
    logLevel: 'warn',
    mobile: true,
    mobileLazy: true,
    position: 'right',
    right: '92px',
    left: '24px',
    bottom: '8px',
    width: 280,
    height: 320,
    modelScale: 2.4,
    modelX: 0,
    modelY: 135,
    renderScale: 1.5,
    maxFps: 45,
    motionCooldown: 1800,
    maxPanelPosts: 5
  }

  var state = {
    status: 'idle',
    initialized: false,
    loading: false,
    lastError: null,
    lastMessageAt: 0,
    articleBottomShown: false,
    events: [],
    app: null,
    model: null,
    viewport: null,
    modelBaseSize: null,
    tipsData: null,
    siteIndex: null,
    blogIndex: null,
    modelView: null,
    lastMotionAt: 0,
    pointerFrame: 0,
    dragState: null,
    boundRendererEvents: false,
    bubbleMode: 'home',
    panelMode: 'home',
    launchSuspended: false,
    launchWaiting: false,
    launchSnapshots: [],
    launchTickerWasRunning: false,
    launchStatusBeforeSuspend: 'idle',
    boundLaunchLifecycle: false
  }

  function metaElement (name) {
    return document.querySelector('meta[name="' + name + '"]')
  }

  function meta (name) {
    var el = metaElement(name)
    return el ? el.content : ''
  }

  function parseBool (value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    var normalized = String(value).toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false
    return fallback
  }

  function parseNumber (value, fallback) {
    if (value === undefined || value === null || value === '') return fallback
    var parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function readConfigFromMeta () {
    var tools = meta('live2d-tools')
    var modelId = parseInt(meta('live2d-model-id'), 10)

    return {
      enabled: parseBool(meta('live2d-enabled'), DEFAULT_CONFIG.enabled),
      debug: parseBool(meta('live2d-debug'), DEFAULT_CONFIG.debug),
      tipsPath: meta('live2d-tips-path') || DEFAULT_CONFIG.tipsPath,
      siteIndexPath: meta('live2d-site-index-path') || DEFAULT_CONFIG.siteIndexPath,
      blogIndexPath: meta('live2d-blog-index-path') || DEFAULT_CONFIG.blogIndexPath,
      modelPath: meta('live2d-model-path') || DEFAULT_CONFIG.modelPath,
      cdnPath: metaElement('live2d-cdn-path') ? meta('live2d-cdn-path') : '',
      cubism5Path: meta('live2d-cubism5-path') || DEFAULT_CONFIG.cubism5Path,
      pixiPath: meta('live2d-pixi-path') || DEFAULT_CONFIG.pixiPath,
      pixiLive2dPath: meta('live2d-pixi-live2d-path') || DEFAULT_CONFIG.pixiLive2dPath,
      modelId: isNaN(modelId) ? DEFAULT_CONFIG.modelId : modelId,
      tools: tools ? tools.split(',').map(function (item) { return item.trim() }).filter(Boolean) : DEFAULT_CONFIG.tools.slice(),
      drag: parseBool(meta('live2d-drag'), DEFAULT_CONFIG.drag),
      showToggleAfterQuit: parseBool(meta('live2d-show-toggle-after-quit'), DEFAULT_CONFIG.showToggleAfterQuit),
      logLevel: meta('live2d-log-level') || DEFAULT_CONFIG.logLevel,
      mobile: parseBool(meta('live2d-mobile'), DEFAULT_CONFIG.mobile),
      mobileLazy: parseBool(meta('live2d-mobile-lazy'), DEFAULT_CONFIG.mobileLazy),
      position: meta('live2d-position') || DEFAULT_CONFIG.position,
      right: meta('live2d-right') || DEFAULT_CONFIG.right,
      left: meta('live2d-left') || DEFAULT_CONFIG.left,
      bottom: meta('live2d-bottom') || DEFAULT_CONFIG.bottom,
      width: parseNumber(meta('live2d-width'), DEFAULT_CONFIG.width),
      height: parseNumber(meta('live2d-height'), DEFAULT_CONFIG.height),
      modelScale: parseNumber(meta('live2d-model-scale'), DEFAULT_CONFIG.modelScale),
      modelX: parseNumber(meta('live2d-model-x'), DEFAULT_CONFIG.modelX),
      modelY: parseNumber(meta('live2d-model-y'), DEFAULT_CONFIG.modelY),
      renderScale: parseNumber(meta('live2d-render-scale'), DEFAULT_CONFIG.renderScale),
      maxFps: parseNumber(meta('live2d-max-fps'), DEFAULT_CONFIG.maxFps),
      motionCooldown: parseNumber(meta('live2d-motion-cooldown'), DEFAULT_CONFIG.motionCooldown),
      maxPanelPosts: parseNumber(meta('live2d-max-panel-posts'), DEFAULT_CONFIG.maxPanelPosts)
    }
  }

  function pushEvent (key, data) {
    state.events.push({ key: key, at: Date.now(), data: data || null })
    if (state.events.length > 30) state.events.shift()
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
    try {
      var current = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(current, patch)))
    } catch (_) {}
  }

  function removeStorageItem (key) {
    try { localStorage.removeItem(key) } catch (_) {}
  }

  function clampNumber (value, min, max, fallback) {
    var parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(min, Math.min(max, parsed))
  }

  function readSavedModelView () {
    try {
      var saved = JSON.parse(localStorage.getItem(MODEL_VIEW_STORAGE_KEY))
      if (!saved || typeof saved !== 'object') return null
      return {
        scale: clampNumber(saved.scale, 0.3, 3, DEFAULT_CONFIG.modelScale),
        x: clampNumber(saved.x, -240, 240, DEFAULT_CONFIG.modelX),
        y: clampNumber(saved.y, -260, 260, DEFAULT_CONFIG.modelY)
      }
    } catch (_) {
      return null
    }
  }

  function saveModelView (view) {
    try {
      localStorage.setItem(MODEL_VIEW_STORAGE_KEY, JSON.stringify(view))
    } catch (_) {}
  }

  function getModelView (config) {
    if (state.modelView) return state.modelView
    var saved = readSavedModelView()
    state.modelView = saved || {
      scale: clampNumber(config && config.modelScale, 0.3, 3, DEFAULT_CONFIG.modelScale),
      x: clampNumber(config && config.modelX, -240, 240, DEFAULT_CONFIG.modelX),
      y: clampNumber(config && config.modelY, -260, 260, DEFAULT_CONFIG.modelY)
    }
    return state.modelView
  }

  function applyModelView (patch, persist) {
    var config = readConfigFromMeta()
    var current = getModelView(config)
    var next = {
      scale: clampNumber(patch && patch.scale !== undefined ? patch.scale : current.scale, 0.3, 3, DEFAULT_CONFIG.modelScale),
      x: clampNumber(patch && patch.x !== undefined ? patch.x : current.x, -240, 240, DEFAULT_CONFIG.modelX),
      y: clampNumber(patch && patch.y !== undefined ? patch.y : current.y, -260, 260, DEFAULT_CONFIG.modelY)
    }
    state.modelView = next
    if (persist !== false) saveModelView(next)
    applyModelViewport(config)
    syncModelControls(next)
    pushEvent('model:view', next)
    return next
  }

  function resetModelView () {
    state.modelView = null
    try { localStorage.removeItem(MODEL_VIEW_STORAGE_KEY) } catch (_) {}
    try { localStorage.removeItem('live2d_model_view_v2') } catch (_) {}
    try { localStorage.removeItem('live2d_model_view') } catch (_) {}
    return applyModelView({
      scale: readConfigFromMeta().modelScale,
      x: readConfigFromMeta().modelX,
      y: readConfigFromMeta().modelY
    }, false)
  }

  function readSavedWidgetPlacement () {
    try {
      var saved = JSON.parse(localStorage.getItem(WIDGET_PLACEMENT_STORAGE_KEY))
      if (!saved || typeof saved !== 'object') return null
      return {
        left: clampNumber(saved.left, 8, window.innerWidth - 80, 8),
        bottom: clampNumber(saved.bottom, 8, window.innerHeight - 80, 8)
      }
    } catch (_) {
      return null
    }
  }

  function saveWidgetPlacement (placement) {
    try {
      localStorage.setItem(WIDGET_PLACEMENT_STORAGE_KEY, JSON.stringify(placement))
    } catch (_) {}
  }

  function loadScript (src) {
    if (!src) return Promise.resolve(src)
    if (document.querySelector('script[data-live2d-assistant-script="' + src + '"]')) return Promise.resolve(src)
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script')
      tag.src = src
      tag.async = false
      tag.dataset.live2dAssistantScript = src
      tag.onload = function () { resolve(src) }
      tag.onerror = function () { reject(new Error('Script load failed: ' + src)) }
      document.head.appendChild(tag)
    })
  }

  function loadJson (path) {
    return fetch(path).then(function (response) {
      if (!response.ok) throw new Error('JSON load failed: ' + path)
      return response.json()
    })
  }

  function hasWidgetDom () {
    return !!(document.getElementById('waifu') || document.getElementById('waifu-toggle'))
  }

  function supportsWebGL () {
    try {
      var canvas = document.createElement('canvas')
      return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')))
    } catch (_) {
      return false
    }
  }

  function isMobileViewport () {
    return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches)
  }

  function pick (value) {
    return Array.isArray(value) ? value[Math.floor(Math.random() * value.length)] : value
  }

  function say (text, priority) {
    var now = Date.now()
    if (!text || (priority || 0) < 9 && now - state.lastMessageAt < 8000) return false
    if (getPanel() && !getPanel().hidden) return false
    if (getBubble() && !getBubble().hidden) return false
    var tips = document.getElementById('waifu-tips')
    if (!tips) return false
    tips.textContent = pick(text)
    tips.classList.add('waifu-tips-active')
    state.lastMessageAt = now
    pushEvent('say', { text: tips.textContent, priority: priority || 8 })
    setTimeout(function () {
      tips.classList.remove('waifu-tips-active')
    }, 4500)
    return true
  }

  function getBubble () {
    return document.getElementById('waifu-bubble')
  }

  function setBubbleVisible (visible) {
    var bubble = getBubble()
    if (!bubble) return false
    bubble.hidden = !visible
    bubble.classList.toggle('waifu-bubble-active', !!visible)
    if (visible) updateBubblePlacement()
    return true
  }

  function closeBubble () {
    return setBubbleVisible(false)
  }

  function toggleBubble (mode) {
    var bubble = getBubble()
    if (!bubble || bubble.hidden || state.bubbleMode !== (mode || 'home')) return openBubble(mode || 'home')
    closeBubble()
    return true
  }

  function openBubble (mode) {
    if (!getBubble()) return false
    var config = readConfigFromMeta()
    state.bubbleMode = mode || 'home'
    closeAssistantPanel()
    renderBubble(config, state.bubbleMode, [])
    setBubbleVisible(true)
    loadSiteIndex(config).then(function (entries) {
      renderBubble(config, state.bubbleMode, entries)
      setBubbleVisible(true)
    })
    return true
  }

  function updateBubblePlacement () {
    var waifu = document.getElementById('waifu')
    var bubble = getBubble()
    if (!waifu || !bubble) return false
    var rect = waifu.getBoundingClientRect()
    bubble.classList.toggle('waifu-bubble-right', rect.left < 470)
    return true
  }

  function applyPlacement (config) {
    var waifu = document.getElementById('waifu')
    if (!waifu) return false
    var saved = readSavedWidgetPlacement()
    if (saved) {
      applyWidgetPlacement(saved.left, saved.bottom, false)
      updateBubblePlacement()
      pushEvent('placement:apply', {
        position: 'custom',
        left: waifu.style.left,
        right: waifu.style.right,
        bottom: waifu.style.bottom
      })
      return true
    }

    var placement = (config && config.position) || DEFAULT_CONFIG.position

    waifu.dataset.live2dPlacement = placement
    waifu.style.top = 'auto'
    waifu.style.bottom = (config && config.bottom) || DEFAULT_CONFIG.bottom

    if (placement === 'left') {
      waifu.style.left = (config && config.left) || DEFAULT_CONFIG.left
      waifu.style.right = 'auto'
    } else {
      waifu.style.left = 'auto'
      waifu.style.right = (config && config.right) || DEFAULT_CONFIG.right
    }

    pushEvent('placement:apply', {
      position: placement,
      left: waifu.style.left,
      right: waifu.style.right,
      bottom: waifu.style.bottom
    })
    updateBubblePlacement()
    return true
  }

  function resetPlacement () {
    try { localStorage.removeItem(WIDGET_PLACEMENT_STORAGE_KEY) } catch (_) {}
    return applyPlacement(readConfigFromMeta())
  }

  function setToggleVisible (visible) {
    var toggleBtn = document.getElementById('waifu-toggle')
    if (!toggleBtn) return false
    toggleBtn.classList.toggle('waifu-toggle-visible', !!visible)
    toggleBtn.setAttribute('aria-hidden', visible ? 'false' : 'true')
    toggleBtn.tabIndex = visible ? 0 : -1
    return true
  }

  function widgetDragBounds (waifu) {
    var panel = getPanel()
    var panelHeight = panel && !panel.hidden ? panel.offsetHeight : 0
    var width = waifu.offsetWidth || DEFAULT_CONFIG.width
    var height = waifu.offsetHeight || DEFAULT_CONFIG.height
    var toolRoom = 42
    var topRoom = panelHeight ? panelHeight + 16 : 8
    return {
      minLeft: 8,
      maxLeft: Math.max(8, window.innerWidth - width - toolRoom),
      minBottom: 8,
      maxBottom: Math.max(8, window.innerHeight - height - topRoom)
    }
  }

  function constrainWidgetPlacement (persist) {
    var waifu = document.getElementById('waifu')
    if (!waifu || waifu.dataset.live2dPlacement !== 'custom') return false
    var rect = waifu.getBoundingClientRect()
    return applyWidgetPlacement(rect.left, window.innerHeight - rect.bottom, persist)
  }

  function applyWidgetPlacement (left, bottom, persist) {
    var waifu = document.getElementById('waifu')
    if (!waifu) return false
    var bounds = widgetDragBounds(waifu)
    var next = {
      left: Math.round(clampNumber(left, bounds.minLeft, bounds.maxLeft, bounds.minLeft)),
      bottom: Math.round(clampNumber(bottom, bounds.minBottom, bounds.maxBottom, bounds.minBottom))
    }
    waifu.dataset.live2dPlacement = 'custom'
    waifu.style.left = next.left + 'px'
    waifu.style.right = 'auto'
    waifu.style.top = 'auto'
    waifu.style.bottom = next.bottom + 'px'
    if (persist !== false) saveWidgetPlacement(next)
    updateBubblePlacement()
    pushEvent('placement:drag', next)
    return next
  }

  function bindWidgetDrag (config) {
    var canvasBox = document.getElementById('waifu-canvas')
    var waifu = document.getElementById('waifu')
    if (!canvasBox || !waifu || waifu.dataset.live2dDragBound === 'true' || !(config && config.drag)) return
    waifu.dataset.live2dDragBound = 'true'

    canvasBox.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button !== 0) return
      var rect = waifu.getBoundingClientRect()
      state.dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: rect.left,
        startBottom: window.innerHeight - rect.bottom,
        dragging: false
      }
      if (typeof canvasBox.setPointerCapture === 'function') {
        try { canvasBox.setPointerCapture(event.pointerId) } catch (_) {}
      }
    }, { passive: true })

    canvasBox.addEventListener('pointermove', function (event) {
      var drag = state.dragState
      if (!drag || drag.pointerId !== event.pointerId) return
      var dx = event.clientX - drag.startX
      var dy = event.clientY - drag.startY
      if (!drag.dragging && Math.sqrt(dx * dx + dy * dy) < 6) return
      drag.dragging = true
      waifu.classList.add('waifu-dragging')
      applyWidgetPlacement(drag.startLeft + dx, drag.startBottom - dy, true)
    }, { passive: true })

    canvasBox.addEventListener('pointerup', function (event) {
      finishWidgetPointer(event, config, canvasBox)
    }, { passive: true })

    canvasBox.addEventListener('pointercancel', function (event) {
      finishWidgetPointer(event, config, canvasBox, true)
    }, { passive: true })
  }

  function finishWidgetPointer (event, config, canvasBox, cancelled) {
    var drag = state.dragState
    if (!drag || drag.pointerId !== event.pointerId) return
    state.dragState = null
    var waifu = document.getElementById('waifu')
    if (waifu) waifu.classList.remove('waifu-dragging')
    if (typeof canvasBox.releasePointerCapture === 'function') {
      try { canvasBox.releasePointerCapture(event.pointerId) } catch (_) {}
    }
    if (!cancelled && !drag.dragging) {
      playRandomMotion(config)
      toggleBubble('home')
    }
  }

  function createToggleButton () {
    if (!document.getElementById('waifu-toggle')) {
      var toggleBtn = document.createElement('button')
      toggleBtn.id = 'waifu-toggle'
      toggleBtn.type = 'button'
      toggleBtn.title = '看板娘'
      toggleBtn.setAttribute('aria-label', '显示看板娘')
      toggleBtn.setAttribute('aria-hidden', 'true')
      toggleBtn.tabIndex = -1
      toggleBtn.innerHTML = '<i class="fas fa-child"></i>'
      toggleBtn.addEventListener('click', show)
      document.body.appendChild(toggleBtn)
    }
    return document.getElementById('waifu-toggle')
  }

  function createShell (config) {
    createToggleButton()

    var waifu = document.getElementById('waifu')
    if (!waifu) {
      waifu = document.createElement('div')
      waifu.id = 'waifu'
      waifu.innerHTML = [
        '<div id="waifu-tips"></div>',
        '<div id="waifu-bubble" hidden></div>',
        '<div id="waifu-panel" hidden></div>',
        '<div id="waifu-canvas" aria-label="Live2D 看板娘"></div>',
        '<div id="waifu-actionbar"></div>',
        '<div id="waifu-tool"></div>'
      ].join('')
      document.body.appendChild(waifu)
    }

    var canvas = document.getElementById('waifu-canvas')
    if (canvas) {
      canvas.style.width = config.width + 'px'
      canvas.style.height = config.height + 'px'
      canvas.tabIndex = 0
    }
    if (waifu) {
      waifu.style.width = config.width + 'px'
      waifu.style.height = config.height + 'px'
    }

    registerTools(config)
    bindActionbarVisibility()
    renderBubble(config, state.bubbleMode, [])
    setBubbleVisible(true)
    applyPlacement(config)
    bindWidgetDrag(config)
    setToggleVisible(waifu.classList.contains('waifu-hidden'))
    return waifu
  }

  function createTool (id, title, iconClass, callback) {
    var tool = document.createElement('button')
    tool.id = 'waifu-tool-' + id
    tool.type = 'button'
    tool.title = title
    tool.setAttribute('aria-label', title)
    tool.innerHTML = '<i class="' + iconClass + '"></i>'
    tool.addEventListener('click', callback)
    return tool
  }

  function registerTools (config) {
    var actionbar = document.getElementById('waifu-actionbar')
    var legacyTool = document.getElementById('waifu-tool')
    if (legacyTool) legacyTool.innerHTML = ''
    if (!actionbar) return
    actionbar.innerHTML = ''
    var toolMap = {
      assistant: function () {
        toggleBubble('home')
      },
      model: function () {
        closeBubble()
        openAssistantPanel('model')
      },
      search: function () {
        openBubble('search')
      },
      random: goRandomPost,
      progress: reportReadingProgress,
      music: openMusicPanel,
      style: switchSiteStyle,
      hitokoto: function () {
        fetch('https://v1.hitokoto.cn')
          .then(function (response) { return response.json() })
          .then(function (data) { say(data.hitokoto || '今天也适合读点东西。', 9) })
          .catch(function () { say('今天也适合读点东西。', 9) })
      },
      photo: capturePhoto,
      info: function () {
        window.open('https://github.com/guansss/pixi-live2d-display', '_blank', 'noopener')
      },
      quit: hide
    }
    var iconMap = {
      assistant: 'fas fa-compass',
      model: 'fas fa-sliders-h',
      search: 'fas fa-search',
      random: 'fas fa-random',
      progress: 'fas fa-tasks',
      music: 'fas fa-music',
      style: 'fas fa-palette',
      hitokoto: 'fas fa-comment',
      photo: 'fas fa-camera',
      info: 'fas fa-info',
      quit: 'fas fa-times'
    }
    var titleMap = {
      assistant: '站内助理',
      model: '模型调节',
      search: '搜索文章',
      random: '随机文章',
      progress: '阅读进度',
      music: '音乐',
      style: '切换风格',
      hitokoto: '随机一句',
      photo: '拍照',
      info: '信息',
      quit: '隐藏'
    }
    var actionTitleMap = {
      search: '搜索',
      random: '随机',
      model: '模型',
      quit: '隐藏'
    }

    var primaryTools = ['search', 'random', 'model', 'quit']
    primaryTools.forEach(function (toolId) {
      if (!toolMap[toolId]) return
      var tool = createTool(toolId, titleMap[toolId], iconMap[toolId], toolMap[toolId])
      tool.id = 'waifu-action-' + toolId
      tool.dataset.waifuActionbarAction = toolId
      tool.innerHTML = '<i class="' + iconMap[toolId] + '"></i><span>' + actionTitleMap[toolId] + '</span>'
      actionbar.appendChild(tool)
    })
    setActionbarVisible(false)
  }

  function setActionbarVisible (visible) {
    var waifu = document.getElementById('waifu')
    var actionbar = document.getElementById('waifu-actionbar')
    if (!waifu || !actionbar) return false
    waifu.classList.toggle('waifu-actionbar-visible', !!visible)
    actionbar.setAttribute('aria-hidden', visible ? 'false' : 'true')
    Array.prototype.slice.call(actionbar.querySelectorAll('button')).forEach(function (button) {
      button.tabIndex = visible ? 0 : -1
    })
    return true
  }

  function bindActionbarVisibility () {
    var canvas = document.getElementById('waifu-canvas')
    var actionbar = document.getElementById('waifu-actionbar')
    if (!canvas || !actionbar || actionbar.dataset.live2dBound === 'true') return
    actionbar.dataset.live2dBound = 'true'
    var hideTimer = null

    function showActionbar () {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      setActionbarVisible(true)
    }

    function shouldKeepActionbar () {
      var active = document.activeElement
      var canvasHovered = false
      var actionbarHovered = false
      try { canvasHovered = canvas.matches(':hover') } catch (_) {}
      try { actionbarHovered = actionbar.matches(':hover') } catch (_) {}
      return canvasHovered || actionbarHovered || active === canvas || actionbar.contains(active)
    }

    function hideActionbarSoon () {
      if (hideTimer) clearTimeout(hideTimer)
      hideTimer = setTimeout(function () {
        hideTimer = null
        if (!shouldKeepActionbar()) setActionbarVisible(false)
      }, 120)
    }

    canvas.addEventListener('mouseenter', showActionbar)
    canvas.addEventListener('mouseleave', hideActionbarSoon)
    canvas.addEventListener('focus', showActionbar)
    canvas.addEventListener('blur', hideActionbarSoon)
    actionbar.addEventListener('mouseenter', showActionbar)
    actionbar.addEventListener('mouseleave', hideActionbarSoon)
    actionbar.addEventListener('focusin', showActionbar)
    actionbar.addEventListener('focusout', hideActionbarSoon)
  }

  function normalizeSiteUrl (url) {
    if (!url) return '/'
    var value = String(url).trim()
    if (value.indexOf('//') === 0) return '/' + value.replace(/^\/+/, '')
    if (value.indexOf('http://') === 0 || value.indexOf('https://') === 0) return value
    return value.charAt(0) === '/' ? value : '/' + value
  }

  function stripText (value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function parseSearchXml (xmlText) {
    if (!xmlText || typeof window.DOMParser !== 'function') return []
    var doc = new window.DOMParser().parseFromString(xmlText, 'application/xml')
    return Array.prototype.slice.call(doc.querySelectorAll('entry')).map(function (entry) {
      var title = stripText(entry.querySelector('title') && entry.querySelector('title').textContent)
      var url = normalizeSiteUrl(entry.querySelector('url') && entry.querySelector('url').textContent)
      var content = stripText(entry.querySelector('content') && entry.querySelector('content').textContent)
      return { title: title, url: url, content: content }
    }).filter(function (entry) {
      return entry.title && entry.url
    })
  }

  function parseSearchJson (jsonText) {
    try {
      var data = JSON.parse(jsonText)
      return (Array.isArray(data) ? data : []).map(function (entry) {
        return {
          title: stripText(entry.title),
          url: normalizeSiteUrl(entry.url),
          content: stripText(entry.content)
        }
      }).filter(function (entry) {
        return entry.title && entry.url
      })
    } catch (_) {
      return []
    }
  }

  function parseSearchIndexText (text, path) {
    var trimmed = String(text || '').trim()
    if ((path && /\.json(?:$|\?)/.test(path)) || trimmed.charAt(0) === '[') return parseSearchJson(trimmed)
    return parseSearchXml(trimmed)
  }

  function loadBlogIndex (config) {
    if (state.blogIndex) return Promise.resolve(state.blogIndex)
    if (!config.blogIndexPath) return Promise.resolve(null)
    if (typeof fetch !== 'function') return Promise.resolve(null)
    return fetch(config.blogIndexPath).then(function (response) {
      if (!response.ok) throw new Error('Blog index load failed: ' + config.blogIndexPath)
      return response.json()
    }).then(function (data) {
      state.blogIndex = data || null
      return state.blogIndex
    }).catch(function () {
      state.blogIndex = null
      return null
    })
  }

  function comparableUrl (url) {
    return normalizeSiteUrl(url).replace(/\/index\.html$/, '/').replace(/\/+$/, '/') || '/'
  }

  function mergeBlogIndexEntries (entries, blogIndex) {
    var posts = blogIndex && Array.isArray(blogIndex.posts) ? blogIndex.posts : []
    if (!posts.length) return entries
    var postByUrl = {}
    posts.forEach(function (post) {
      postByUrl[comparableUrl(post.url)] = post
    })

    var seen = {}
    var merged = entries.map(function (entry) {
      var post = postByUrl[comparableUrl(entry.url)]
      var next = post ? Object.assign({}, post, {
        title: post.title || entry.title,
        url: normalizeSiteUrl(post.url || entry.url),
        content: entry.content || post.description || ''
      }) : entry
      seen[comparableUrl(next.url)] = true
      return next
    })

    posts.forEach(function (post) {
      var key = comparableUrl(post.url)
      if (seen[key]) return
      merged.push(Object.assign({}, post, {
        url: normalizeSiteUrl(post.url),
        content: post.description || ''
      }))
    })

    return merged
  }

  function loadSiteIndex (config) {
    if (state.siteIndex) return Promise.resolve(state.siteIndex)
    if (typeof fetch !== 'function') {
      state.siteIndex = collectPostsFromDom()
      return Promise.resolve(state.siteIndex)
    }
    return fetch(config.siteIndexPath).then(function (response) {
      if (!response.ok) throw new Error('Search index load failed: ' + config.siteIndexPath)
      return response.text()
    }).then(function (xmlText) {
      var searchEntries = parseSearchIndexText(xmlText, config.siteIndexPath)
      return loadBlogIndex(config).then(function (blogIndex) {
        state.siteIndex = mergeBlogIndexEntries(searchEntries, blogIndex)
        return state.siteIndex
      })
    }).catch(function () {
      return loadBlogIndex(config).then(function (blogIndex) {
        state.siteIndex = mergeBlogIndexEntries(collectPostsFromDom(), blogIndex)
        return state.siteIndex
      })
    })
  }

  function collectPostsFromDom () {
    var links = Array.prototype.slice.call(document.querySelectorAll('.recent-post-item a.article-title, #recent-posts a.article-title, .card-recent-post a, #aside-content a'))
    var seen = {}
    return links.map(function (link) {
      var title = stripText(link.textContent || link.getAttribute('title'))
      var url = normalizeSiteUrl(link.getAttribute('href'))
      return { title: title, url: url, content: '' }
    }).filter(function (entry) {
      if (!entry.title || !entry.url || seen[entry.url]) return false
      seen[entry.url] = true
      return true
    })
  }

  function searchEntries (entries, query, limit) {
    var keyword = stripText(query).toLowerCase()
    if (!keyword) return entries.slice(0, limit)
    return entries.filter(function (entry) {
      return (entry.title + ' ' + entry.content).toLowerCase().indexOf(keyword) >= 0
    }).slice(0, limit)
  }

  function getCurrentEntry (entries) {
    var currentPath = comparableUrl(window.location.pathname)
    var list = Array.isArray(entries) ? entries : []
    var matched = list.find(function (entry) {
      return comparableUrl(entry.url) === currentPath
    })
    if (matched) return matched

    var titleNode = document.querySelector('#article-title, .post-title, h1')
    var title = stripText(titleNode && titleNode.textContent)
    if (!title) return null
    return { title: title, url: currentPath, tags: [], categories: [], content: '' }
  }

  function getRecommendedEntries (entries, limit) {
    var list = Array.isArray(entries) ? entries : []
    var current = getCurrentEntry(list)
    var max = Math.max(1, limit || 4)
    if (!current) return list.slice(0, max)

    var scored = list.filter(function (entry) {
      return comparableUrl(entry.url) !== comparableUrl(current.url)
    }).map(function (entry) {
      return { entry: entry, score: recommendationScore(current, entry) }
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score
      return String(b.entry.date || '').localeCompare(String(a.entry.date || ''))
    })

    var strong = scored.filter(function (item) { return item.score > 0 }).map(function (item) { return item.entry })
    if (strong.length >= max) return strong.slice(0, max)
    var fallback = scored.map(function (item) { return item.entry })
    return strong.concat(fallback.filter(function (entry) {
      return strong.indexOf(entry) < 0
    })).slice(0, max)
  }

  function recommendationScore (current, entry) {
    var score = 0
    var currentCategories = current.categories || []
    var entryCategories = entry.categories || []
    var currentTags = current.tags || []
    var entryTags = entry.tags || []

    entryCategories.forEach(function (category) {
      if (currentCategories.indexOf(category) >= 0) score += 5
    })
    entryTags.forEach(function (tag) {
      if (currentTags.indexOf(tag) >= 0) score += 3
    })

    var currentTitle = stripText(current.title).toLowerCase()
    var entryTitle = stripText(entry.title).toLowerCase()
    currentTitle.split(/[\s:：、，。｜|-]+/).forEach(function (token) {
      if (token.length >= 3 && entryTitle.indexOf(token) >= 0) score += 1
    })

    return score
  }

  function getPanel () {
    return document.getElementById('waifu-panel')
  }

  function setPanelVisible (visible) {
    var panel = getPanel()
    if (!panel) return false
    panel.hidden = !visible
    panel.classList.toggle('waifu-panel-active', !!visible)
    if (visible) constrainWidgetPlacement(true)
    return true
  }

  function toggleAssistantPanel (mode) {
    var panel = getPanel()
    if (!panel || panel.hidden || state.panelMode !== mode) return openAssistantPanel(mode || 'home')
    closeAssistantPanel()
    return true
  }

  function openAssistantPanel (mode) {
    var config = readConfigFromMeta()
    state.panelMode = mode || 'home'
    closeBubble()
    renderAssistantPanel(config, state.panelMode, [])
    setPanelVisible(true)
    loadSiteIndex(config).then(function (entries) {
      renderAssistantPanel(config, state.panelMode, entries)
    })
    say('我可以帮你找文章、挑一篇读，或者打开音乐和主题。', 9)
    return true
  }

  function closeAssistantPanel () {
    return setPanelVisible(false)
  }

  function renderAssistantPanel (config, mode, entries) {
    var panel = getPanel()
    if (!panel) return false
    var list = entries && entries.length ? entries : collectPostsFromDom()
    var progress = getReadingProgress()
    var latest = list.slice(0, Math.max(1, config.maxPanelPosts))
    var body = mode === 'model'
      ? renderModelControls(getModelView(config))
      : mode === 'recommend'
        ? renderRecommendationPanel(list, config)
        : [
          '<div class="waifu-panel-search">',
            '<input id="waifu-search-input" type="search" placeholder="搜索文章、标签或关键词" autocomplete="off" value="">',
          '</div>',
          '<div id="waifu-panel-results">' + renderPostList(latest, '最新文章') + '</div>'
        ].join('')

    panel.innerHTML = [
      '<div class="waifu-panel-header">',
        '<span>Yurisa Navigator</span>',
        '<button type="button" class="waifu-panel-close" aria-label="关闭"><i class="fas fa-times"></i></button>',
      '</div>',
      '<div class="waifu-panel-status">',
        '<button type="button" data-waifu-action="progress"><strong>' + progress.percent + '%</strong><span>阅读进度</span></button>',
        '<button type="button" data-waifu-action="random"><strong>' + list.length + '</strong><span>可读文章</span></button>',
      '</div>',
      body,
      '<div class="waifu-panel-actions">',
        '<button type="button" data-waifu-action="latest"><i class="fas fa-clock"></i><span>最新</span></button>',
        '<button type="button" data-waifu-action="recommend"><i class="fas fa-stream"></i><span>推荐</span></button>',
        '<button type="button" data-waifu-action="reading"><i class="fas fa-route"></i><span>路线</span></button>',
        '<button type="button" data-waifu-action="model"><i class="fas fa-sliders-h"></i><span>模型</span></button>',
        '<button type="button" data-waifu-action="random"><i class="fas fa-dice"></i><span>随读</span></button>',
        '<button type="button" data-waifu-action="categories"><i class="fas fa-folder"></i><span>分类</span></button>',
        '<button type="button" data-waifu-action="tags"><i class="fas fa-tags"></i><span>标签</span></button>',
        '<button type="button" data-waifu-action="top"><i class="fas fa-arrow-up"></i><span>顶部</span></button>',
        '<button type="button" data-waifu-action="music"><i class="fas fa-music"></i><span>音乐</span></button>',
        '<button type="button" data-waifu-action="style"><i class="fas fa-palette"></i><span>风格</span></button>',
      '</div>'
    ].join('')

    bindAssistantPanel(panel, config, list)
    return true
  }

  function renderBubble (config, mode, entries) {
    var bubble = getBubble()
    if (!bubble) return false
    var list = entries && entries.length ? entries : collectPostsFromDom()
    var progress = getReadingProgress()
    var body = mode === 'search'
      ? [
          '<div class="waifu-bubble-kicker">搜索文章</div>',
          '<div class="waifu-bubble-search">',
            '<input id="waifu-bubble-search-input" type="search" placeholder="输入标题或关键词" autocomplete="off" value="">',
          '</div>',
          '<div id="waifu-bubble-results">' + renderBubbleResultList(list.slice(0, 4)) + '</div>'
        ].join('')
      : [
          '<p>欢迎来到 Yurisa 的小站。这里记录技术、音乐和游戏。</p>',
          '<p>想读点什么的话，我可以帮你找文章，或者随机挑一篇。</p>',
          '<div class="waifu-bubble-stats">',
            '<button type="button" data-waifu-bubble-action="progress"><strong>' + progress.percent + '%</strong><span>阅读进度</span></button>',
            '<button type="button" data-waifu-bubble-action="random"><strong>' + list.length + '</strong><span>可读文章</span></button>',
          '</div>',
          '<div class="waifu-bubble-links">',
            '<button type="button" data-waifu-bubble-action="search">◇ 搜索文章</button>',
            '<button type="button" data-waifu-bubble-action="recommend">◆ 推荐下一篇</button>',
            '<button type="button" data-waifu-bubble-action="random">◆ 随机一篇</button>',
            '<button type="button" data-waifu-bubble-action="reading">◇ 阅读路线</button>',
            '<button type="button" data-waifu-bubble-action="model">◇ 调整模型</button>',
          '</div>'
        ].join('')

    bubble.innerHTML = [
      '<button type="button" class="waifu-bubble-close" aria-label="收起"><i class="fas fa-times"></i></button>',
      '<div class="waifu-bubble-title">Yurisa Chan</div>',
      body
    ].join('')
    bindBubble(bubble, config, list)
    updateBubblePlacement()
    return true
  }

  function renderBubbleResultList (entries) {
    if (!entries.length) return '<div class="waifu-bubble-empty">暂时没拿到文章索引。</div>'
    return [
      '<ul class="waifu-bubble-results-list">',
      entries.map(function (entry) {
        return '<li><a href="' + entry.url + '">' + escapeHtml(entry.title) + '</a></li>'
      }).join(''),
      '</ul>'
    ].join('')
  }

  function bindBubble (bubble, config, entries) {
    var closeBtn = bubble.querySelector('.waifu-bubble-close')
    if (closeBtn) closeBtn.addEventListener('click', closeBubble)

    var input = bubble.querySelector('#waifu-bubble-search-input')
    var results = bubble.querySelector('#waifu-bubble-results')
    if (input && results) {
      input.addEventListener('input', function () {
        results.innerHTML = renderBubbleResultList(searchEntries(entries, input.value, 4))
      })
      setTimeout(function () { input.focus() }, 0)
    }

    Array.prototype.slice.call(bubble.querySelectorAll('[data-waifu-bubble-action]')).forEach(function (button) {
      button.addEventListener('click', function () {
        runAssistantAction(button.dataset.waifuBubbleAction, entries)
      })
    })
  }

  function renderPostList (entries, label) {
    if (!entries.length) return '<div class="waifu-panel-empty">暂时没拿到文章索引。</div>'
    return [
      '<div class="waifu-panel-list-label">' + label + '</div>',
      '<ul class="waifu-panel-list">',
      entries.map(function (entry) {
        return '<li><a href="' + entry.url + '">' + escapeHtml(entry.title) + '</a></li>'
      }).join(''),
      '</ul>'
    ].join('')
  }

  function renderRecommendationPanel (entries, config) {
    var recommendations = getRecommendedEntries(entries, Math.max(1, config.maxPanelPosts))
    if (!recommendations.length) return '<div class="waifu-panel-empty">暂时没有可推荐的下一篇。</div>'
    return [
      '<div class="waifu-panel-recommend">',
        '<div class="waifu-panel-list-label">推荐下一篇</div>',
        '<ul class="waifu-panel-list">',
          recommendations.map(function (entry) {
            var meta = [(entry.categories || [])[0], (entry.tags || []).slice(0, 2).join(' / ')].filter(Boolean).join(' · ')
            return [
              '<li>',
                '<a href="' + entry.url + '">' + escapeHtml(entry.title) + '</a>',
                meta ? '<small>' + escapeHtml(meta) + '</small>' : '',
              '</li>'
            ].join('')
          }).join(''),
        '</ul>',
        '<div class="waifu-model-presets">',
          '<button type="button" data-waifu-action="go-recommend">打开第一篇推荐</button>',
          '<button type="button" data-waifu-action="reading">阅读路线</button>',
        '</div>',
      '</div>'
    ].join('')
  }

  function renderModelControls (view) {
    return [
      '<div class="waifu-model-controls">',
        '<div class="waifu-panel-list-label">模型视窗</div>',
        renderRangeControl('scale', '缩放', view.scale, 0.3, 3, 0.01),
        renderRangeControl('x', 'X', view.x, -160, 160, 1),
        renderRangeControl('y', 'Y', view.y, -180, 180, 1),
        '<div class="waifu-model-presets">',
          '<button type="button" data-waifu-preset="full">全身</button>',
          '<button type="button" data-waifu-preset="half">半身</button>',
          '<button type="button" data-waifu-preset="reset">重置</button>',
          '<button type="button" data-waifu-placement-reset>归位</button>',
        '</div>',
      '</div>'
    ].join('')
  }

  function renderRangeControl (field, label, value, min, max, step) {
    var shown = field === 'scale' ? Number(value).toFixed(2) : Math.round(value)
    return [
      '<label class="waifu-model-range">',
        '<span>' + label + '</span>',
        '<output data-waifu-model-output="' + field + '">' + shown + '</output>',
        '<input type="range" data-waifu-model-field="' + field + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">',
      '</label>'
    ].join('')
  }

  function escapeHtml (value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
    })
  }

  function bindAssistantPanel (panel, config, entries) {
    var closeBtn = panel.querySelector('.waifu-panel-close')
    if (closeBtn) closeBtn.addEventListener('click', closeAssistantPanel)

    var input = panel.querySelector('#waifu-search-input')
    var results = panel.querySelector('#waifu-panel-results')
    if (input && results) {
      input.addEventListener('input', function () {
        var matches = searchEntries(entries, input.value, Math.max(1, config.maxPanelPosts))
        results.innerHTML = renderPostList(matches, input.value ? '搜索结果' : '最新文章')
      })
      if (state.panelMode === 'search') setTimeout(function () { input.focus() }, 0)
    }

    Array.prototype.slice.call(panel.querySelectorAll('[data-waifu-action]')).forEach(function (button) {
      button.addEventListener('click', function () {
        runAssistantAction(button.dataset.waifuAction, entries)
      })
    })

    Array.prototype.slice.call(panel.querySelectorAll('[data-waifu-model-field]')).forEach(function (input) {
      input.addEventListener('input', function () {
        var patch = {}
        patch[input.dataset.waifuModelField] = parseFloat(input.value)
        applyModelView(patch, true)
      })
    })

    Array.prototype.slice.call(panel.querySelectorAll('[data-waifu-preset]')).forEach(function (button) {
      button.addEventListener('click', function () {
        applyModelPreset(button.dataset.waifuPreset)
      })
    })

    Array.prototype.slice.call(panel.querySelectorAll('[data-waifu-placement-reset]')).forEach(function (button) {
      button.addEventListener('click', function () {
        resetPlacement()
      })
    })
  }

  function syncModelControls (view) {
    var panel = getPanel()
    if (!panel) return
    ;['scale', 'x', 'y'].forEach(function (field) {
      var input = panel.querySelector('[data-waifu-model-field="' + field + '"]')
      var output = panel.querySelector('[data-waifu-model-output="' + field + '"]')
      if (input) input.value = view[field]
      if (output) output.textContent = field === 'scale' ? Number(view[field]).toFixed(2) : Math.round(view[field])
    })
  }

  function applyModelPreset (preset) {
    if (preset === 'half') {
      applyModelView({ scale: 1.48, x: 0, y: 86 }, true)
      say('已切到半身视图。', 9)
    } else if (preset === 'full') {
      applyModelView({ scale: 1, x: 0, y: 0 }, true)
      say('已切到全身视图。', 9)
    } else {
      resetModelView()
      say('模型视窗已重置。', 9)
    }
  }

  function runAssistantAction (action, entries) {
    if (action === 'latest') {
      openAssistantPanel('home')
    } else if (action === 'recommend') {
      closeBubble()
      openAssistantPanel('recommend')
    } else if (action === 'go-recommend') {
      goRecommendedPost(entries)
    } else if (action === 'reading') {
      window.location.href = '/reading/'
    } else if (action === 'search') {
      openBubble('search')
    } else if (action === 'model') {
      closeBubble()
      openAssistantPanel('model')
    } else if (action === 'random') {
      goRandomPost(entries)
    } else if (action === 'categories') {
      window.location.href = '/categories/'
    } else if (action === 'tags') {
      window.location.href = '/tags/'
    } else if (action === 'music') {
      openMusicPanel()
    } else if (action === 'style') {
      switchSiteStyle()
    } else if (action === 'progress') {
      reportReadingProgress()
    } else if (action === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      say('回到顶部。', 9)
    }
  }

  function goRandomPost (entries) {
    var config = readConfigFromMeta()
    var list = Array.isArray(entries) && entries.length ? entries : state.siteIndex
    if (list && list.length) return navigateToRandomPost(list)
    loadSiteIndex(config).then(navigateToRandomPost)
    return true
  }

  function navigateToRandomPost (entries) {
    if (!entries || !entries.length) {
      say('现在还没拿到文章列表。', 9)
      return false
    }
    var currentPath = window.location.pathname.replace(/\/index\.html$/, '/')
    var candidates = entries.filter(function (entry) {
      return normalizeSiteUrl(entry.url).replace(/\/index\.html$/, '/') !== currentPath
    })
    var target = pick(candidates.length ? candidates : entries)
    say('给你挑一篇：' + target.title, 9)
    setTimeout(function () {
      window.location.href = target.url
    }, 350)
    return true
  }

  function goRecommendedPost (entries) {
    var config = readConfigFromMeta()
    var list = Array.isArray(entries) && entries.length ? entries : state.siteIndex
    if (list && list.length) return navigateToRecommendedPost(list, config)
    loadSiteIndex(config).then(function (loaded) {
      navigateToRecommendedPost(loaded, config)
    })
    return true
  }

  function navigateToRecommendedPost (entries, config) {
    var recommendations = getRecommendedEntries(entries, Math.max(1, (config && config.maxPanelPosts) || DEFAULT_CONFIG.maxPanelPosts))
    if (!recommendations.length) {
      say('暂时没找到合适的下一篇。', 9)
      return false
    }
    var target = recommendations[0]
    say('下一篇可以读：' + target.title, 9)
    setTimeout(function () {
      window.location.href = target.url
    }, 350)
    return true
  }

  function getReadingProgress () {
    var target = document.querySelector('.post-content, #article-container, article, #content-inner')
    var rect = target ? target.getBoundingClientRect() : null
    var scrollTop = window.scrollY || document.documentElement.scrollTop || 0
    var doc = document.documentElement
    var total = Math.max(1, (target ? target.scrollHeight + Math.max(0, scrollTop + rect.top) : doc.scrollHeight) - window.innerHeight)
    var value = target ? Math.max(0, -rect.top) : scrollTop
    var percent = Math.max(0, Math.min(100, Math.round(value / total * 100)))
    return { percent: percent, value: value, total: total }
  }

  function reportReadingProgress () {
    var progress = getReadingProgress()
    if (progress.percent >= 95) {
      say('这篇快读完了，可以去归档里继续翻下一篇。', 9)
    } else {
      say('现在读到大约 ' + progress.percent + '%。', 9)
    }
    return true
  }

  function openMusicPanel () {
    var btn = document.getElementById('music-player-btn')
    if (btn) {
      btn.click()
      say('音乐面板打开了。', 9)
      return true
    }
    say('音乐按钮还没准备好。', 9)
    return false
  }

  function switchSiteStyle () {
    var btn = document.getElementById('style-switcher-btn')
    if (btn) {
      btn.click()
      say('站点风格已切换。', 9)
      return true
    }
    say('风格切换按钮还没准备好。', 9)
    return false
  }

  function show () {
    removeStorageItem('waifu-disabled')
    removeStorageItem('waifu-display')
    var waifu = document.getElementById('waifu')
    if (waifu) {
      waifu.classList.remove('waifu-hidden')
      setToggleVisible(false)
      applyPlacement(readConfigFromMeta())
      openBubble(state.bubbleMode || 'home')
      setTimeout(function () { waifu.classList.add('waifu-active') }, 0)
      setStatus('visible')
      saveState({ visible: true })
      return
    }
    init({ forceLoad: true })
  }

  function hide () {
    var waifu = document.getElementById('waifu')
    if (waifu) {
      waifu.classList.remove('waifu-active')
      waifu.classList.add('waifu-hidden')
      closeAssistantPanel()
      closeBubble()
      setToggleVisible(true)
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
      applyPlacement(readConfigFromMeta())
      if (getPanel() && !getPanel().hidden) openAssistantPanel(state.panelMode)
      pushEvent('pjax:complete')
    })
  }

  function loadTips (config) {
    if (state.tipsData) return Promise.resolve(state.tipsData)
    return loadJson(config.tipsPath).then(function (tips) {
      state.tipsData = tips
      return tips
    }).catch(function () {
      state.tipsData = { message: { default: [] } }
      return state.tipsData
    })
  }

  function setupPixiRenderer (config) {
    var canvasBox = document.getElementById('waifu-canvas')
    if (!canvasBox) throw new Error('#waifu-canvas is not available')
    if (!window.PIXI || !window.PIXI.live2d || !window.PIXI.live2d.Live2DModel) {
      throw new Error('PIXI.live2d.Live2DModel is not available')
    }

    destroyPixiRenderer()
    canvasBox.innerHTML = ''

    var app = new window.PIXI.Application({
      width: config.width,
      height: config.height,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.max(1, config.renderScale)
    })
    app.ticker.maxFPS = config.maxFps > 0 ? config.maxFps : 0
    app.view.id = 'live2d'
    app.view.style.width = '100%'
    app.view.style.height = '100%'
    app.view.style.display = 'block'
    canvasBox.appendChild(app.view)
    state.app = app
    state.viewport = createModelViewport(app)
    app.stage.addChild(state.viewport)

    return loadLive2DModel(config).then(function (model) {
      state.model = model
      state.modelBaseSize = {
        width: model.width || config.width,
        height: model.height || config.height
      }
      state.viewport.addChild(model)
      fitModel(model, config)
      bindRendererEvents(config)
      setStatus('visible')
      pushEvent('renderer:mounted', { engine: 'pixi-live2d-display' })
      return model
    })
  }

  function loadLive2DModel (config) {
    return window.PIXI.live2d.Live2DModel.from(config.modelPath, { autoInteract: false }).catch(function () {
      return window.PIXI.live2d.Live2DModel.from(config.modelPath)
    })
  }

  function destroyPixiRenderer () {
    state.boundRendererEvents = false
    if (state.model) {
      try { state.model.destroy() } catch (_) {}
      state.model = null
    }
    state.viewport = null
    state.modelBaseSize = null
    if (state.app) {
      try { state.app.destroy(true, { children: true, texture: false, baseTexture: false }) } catch (_) {}
      state.app = null
    }
  }

  function createModelViewport (app) {
    if (window.PIXI && typeof window.PIXI.Container === 'function') return new window.PIXI.Container()
    return {
      x: 0,
      y: 0,
      scale: { set: function () {} },
      addChild: function (child) {
        if (app && app.stage && typeof app.stage.addChild === 'function') app.stage.addChild(child)
      }
    }
  }

  function setDisplayScale (displayObject, scale) {
    if (!displayObject || !displayObject.scale) return
    if (typeof displayObject.scale.set === 'function') {
      displayObject.scale.set(scale)
      return
    }
    displayObject.scale.x = scale
    displayObject.scale.y = scale
  }

  function applyModelViewport (config) {
    if (!state.viewport) return
    var view = getModelView(config)
    state.viewport.x = config.width / 2 + view.x
    state.viewport.y = config.height * 0.54 + view.y
    setDisplayScale(state.viewport, view.scale)
  }

  function fitModel (model, config) {
    if (!model) return
    model.anchor.set(0.5, 0.5)
    var baseSize = state.modelBaseSize || { width: model.width, height: model.height }
    var scale = Math.min(config.width / baseSize.width, config.height / baseSize.height) * 1.06
    if (Number.isFinite(scale) && scale > 0) setDisplayScale(model, scale)
    model.x = 0
    model.y = 0
    applyModelViewport(config)
  }

  function bindRendererEvents (config) {
    var canvasBox = document.getElementById('waifu-canvas')
    if (!canvasBox || state.boundRendererEvents) return
    state.boundRendererEvents = true

    canvasBox.addEventListener('mousemove', function (event) {
      if (state.pointerFrame) return
      state.pointerFrame = window.requestAnimationFrame(function () {
        state.pointerFrame = 0
        focusModel(event, config)
      })
    }, { passive: true })

    canvasBox.addEventListener('mouseleave', function () {
      focusModel(null, config)
    }, { passive: true })

    if (!config.drag) {
      canvasBox.addEventListener('pointerdown', function () {
        playRandomMotion(config)
        say(pick(state.tipsData && state.tipsData.message && state.tipsData.message.tapBody) || '我听到了。', 9)
      }, { passive: true })
    }
  }

  function focusModel (event, config) {
    if (!state.model) return
    var x = 0
    var y = 0
    if (event) {
      var rect = document.getElementById('waifu-canvas').getBoundingClientRect()
      x = ((event.clientX - rect.left) / rect.width - 0.5) * 2
      y = ((event.clientY - rect.top) / rect.height - 0.5) * 2
    }

    if (typeof state.model.focus === 'function') {
      state.model.focus(x, y)
      return
    }

    var coreModel = state.model.internalModel && state.model.internalModel.coreModel
    if (!coreModel || typeof coreModel.setParameterValueById !== 'function') return
    coreModel.setParameterValueById('ParamAngleX', x * 25)
    coreModel.setParameterValueById('ParamAngleY', -y * 15)
    coreModel.setParameterValueById('ParamEyeBallX', x)
    coreModel.setParameterValueById('ParamEyeBallY', -y)
  }

  function motionDefinitions () {
    var motionManager = state.model && state.model.internalModel && state.model.internalModel.motionManager
    return motionManager && motionManager.definitions ? motionManager.definitions : {}
  }

  function playRandomMotion (config) {
    if (!state.model || typeof state.model.motion !== 'function') return false
    var now = Date.now()
    if (now - state.lastMotionAt < config.motionCooldown) return false

    var definitions = motionDefinitions()
    var groups = Object.keys(definitions).filter(function (group) {
      return definitions[group] && definitions[group].length
    })
    if (!groups.length) return false

    var group = groups.includes('Idle') ? 'Idle' : groups[Math.floor(Math.random() * groups.length)]
    var index = Math.floor(Math.random() * definitions[group].length)
    state.lastMotionAt = now
    try {
      state.model.motion(group, index)
      pushEvent('motion:play', { group: group, index: index })
      return true
    } catch (error) {
      setError('MOTION_FAILED', error)
      return false
    }
  }

  function capturePhoto () {
    var canvas = state.app && state.app.view
    if (!canvas) return false
    say('照片已准备好。', 9)
    var link = document.createElement('a')
    link.style.display = 'none'
    link.href = canvas.toDataURL('image/png')
    link.download = 'live2d-photo.png'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return true
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
      renderer: {
        engine: 'pixi-live2d-display',
        app: !!state.app,
        model: !!state.model,
        motions: Object.keys(motionDefinitions()),
        modelView: getModelView(window.__live2dAssistant ? window.__live2dAssistant.config : readConfigFromMeta())
      },
      assistant: {
        panelOpen: !!(getPanel() && !getPanel().hidden),
        panelMode: state.panelMode,
        indexCount: state.siteIndex ? state.siteIndex.length : 0,
        blogIndexCount: state.blogIndex && Array.isArray(state.blogIndex.posts) ? state.blogIndex.posts.length : 0
      },
      dom: {
        waifu: !!document.getElementById('waifu'),
        tips: !!document.getElementById('waifu-tips'),
        button: !!document.getElementById(BUTTON_ID)
      },
      launch: {
        suspended: state.launchSuspended,
        waiting: state.launchWaiting
      }
    }
  }

  function isLaunchPending () {
    var launchState = document.documentElement && document.documentElement.dataset.launchState
    return ['candidate', 'active', 'loading', 'ready', 'travelling', 'gate-ready', 'entering'].indexOf(launchState) >= 0
  }

  function snapshotLaunchElement (element) {
    if (!element) return
    state.launchSnapshots.push({
      element: element,
      visibility: element.style.visibility,
      pointerEvents: element.style.pointerEvents,
      ariaHidden: element.getAttribute('aria-hidden')
    })
    element.style.visibility = 'hidden'
    element.style.pointerEvents = 'none'
    element.setAttribute('aria-hidden', 'true')
  }

  function restoreLaunchElements () {
    state.launchSnapshots.forEach(function (snapshot) {
      if (!snapshot.element) return
      snapshot.element.style.visibility = snapshot.visibility
      snapshot.element.style.pointerEvents = snapshot.pointerEvents
      if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden')
      else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden)
    })
    state.launchSnapshots = []
  }

  /**
   * Temporarily pause and hide Live2D without touching the user's visibility
   * preference. The launch coordinator keeps the existing page active when
   * suspension fails, so Pixi and Three never render concurrently.
   */
  function suspendForLaunch () {
    if (state.launchSuspended) return true
    // If initialization has not created a ticker yet there is nothing we can
    // reliably pause; report failure so the coordinator does not mount Three.
    if (state.loading && !state.app) return false
    state.launchStatusBeforeSuspend = state.status
    state.launchTickerWasRunning = false
    state.launchSnapshots = []

    try {
      if (state.app && state.app.ticker) {
        if (typeof state.app.ticker.stop !== 'function') return false
        state.launchTickerWasRunning = state.app.ticker.started !== false
        state.app.ticker.stop()
      }
      snapshotLaunchElement(document.getElementById('waifu'))
      snapshotLaunchElement(document.getElementById('waifu-toggle'))
      state.launchSuspended = true
      setStatus('launch-suspended')
      pushEvent('launch:suspend')
      return true
    } catch (error) {
      restoreLaunchElements()
      if (state.launchTickerWasRunning && state.app && state.app.ticker && typeof state.app.ticker.start === 'function') {
        try { state.app.ticker.start() } catch (_) {}
      }
      state.launchTickerWasRunning = false
      state.launchSuspended = false
      pushEvent('launch:suspend-failed', { message: error && error.message })
      return false
    }
  }

  function resumeFromLaunch () {
    if (!state.launchSuspended && !state.launchWaiting && !state.launchSnapshots.length) {
      return Promise.resolve(false)
    }
    var wasSuspended = state.launchSuspended
    var shouldInitialize = state.launchWaiting && !state.initialized && !state.loading
    restoreLaunchElements()

    if (wasSuspended && state.launchTickerWasRunning && state.app && state.app.ticker && typeof state.app.ticker.start === 'function') {
      try { state.app.ticker.start() } catch (_) {}
    }
    state.launchTickerWasRunning = false
    state.launchSuspended = false
    state.launchWaiting = false
    if (wasSuspended) setStatus(state.launchStatusBeforeSuspend || (state.initialized ? 'visible' : 'idle'))
    pushEvent('launch:resume')

    if (shouldInitialize) return init()
    return Promise.resolve(wasSuspended)
  }

  function bootWhenLaunchReady () {
    if (!isLaunchPending()) return init()
    state.launchWaiting = true
    setStatus('launch-waiting')
    pushEvent('launch:wait')
    return Promise.resolve(false)
  }

  function bindLaunchLifecycle () {
    if (state.boundLaunchLifecycle) return
    state.boundLaunchLifecycle = true
    document.addEventListener('yurisa:launch-complete', resumeFromLaunch)
  }

  function bootstrapMobileLazy (config) {
    createToggleButton()
    setToggleVisible(true)
    window.__live2dAssistant = window.__live2dAssistant || {}
    window.__live2dAssistant.config = config
    setStatus('mobile-lazy')
    pushEvent('mobile:lazy-ready')
    return Promise.resolve(false)
  }

  function init (options) {
    options = options || {}
    var config = readConfigFromMeta()
    window.__live2dAssistant = window.__live2dAssistant || {}
    window.__live2dAssistant.config = config

    if (!config.enabled) {
      setStatus('disabled')
      return Promise.resolve(false)
    }
    var mobileViewport = isMobileViewport()
    if (!config.mobile && mobileViewport) {
      setStatus('mobile-disabled')
      return Promise.resolve(false)
    }
    if (config.mobileLazy && mobileViewport && !options.forceLoad && !state.initialized && !state.loading) {
      return bootstrapMobileLazy(config)
    }
    if (!supportsWebGL()) {
      setStatus('webgl-disabled')
      return Promise.resolve(false)
    }

    injectRightsideButton()
    bindBlogEvents()
    createShell(config)
    if (state.initialized || state.loading) return Promise.resolve(true)

    state.loading = true
    setStatus('loading')

    return loadTips(config)
      .then(function () {
        return loadScript(config.cubism5Path)
      })
      .then(function () {
        return loadScript(config.pixiPath)
      })
      .then(function () {
        return loadScript(config.pixiLive2dPath)
      })
      .then(function () {
        return setupPixiRenderer(config)
      })
      .then(function () {
        state.loading = false
        state.initialized = hasWidgetDom() && !!state.app && !!state.model
        applyPlacement(config)
        document.getElementById('waifu').classList.add('waifu-active')
        var defaults = state.tipsData && state.tipsData.message && state.tipsData.message.default
        say(pick(defaults) || '欢迎回来，今天也在这里陪你。', 10)
        return true
      })
      .catch(function (error) {
        state.loading = false
        setError('INIT_FAILED', error)
        return false
      })
  }

  window.__live2dAssistant = {
    version: '0.3.0',
    init: init,
    show: show,
    hide: hide,
    toggle: toggle,
    say: say,
    applyPlacement: applyPlacement,
    resetPlacement: resetPlacement,
    openPanel: openAssistantPanel,
    closePanel: closeAssistantPanel,
    applyModelView: applyModelView,
    resetModelView: resetModelView,
    randomPost: goRandomPost,
    recommendedPost: goRecommendedPost,
    reportProgress: reportReadingProgress,
    playRandomMotion: function () { return playRandomMotion(readConfigFromMeta()) },
    capturePhoto: capturePhoto,
    suspendForLaunch: suspendForLaunch,
    resumeFromLaunch: resumeFromLaunch,
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
      hide: hide,
      supportsWebGL: supportsWebGL,
      readConfigFromMeta: readConfigFromMeta,
      injectRightsideButton: injectRightsideButton,
      applyPlacement: applyPlacement,
      resetPlacement: resetPlacement,
      openAssistantPanel: openAssistantPanel,
      closeAssistantPanel: closeAssistantPanel,
      applyModelView: applyModelView,
      resetModelView: resetModelView,
      parseSearchXml: parseSearchXml,
      parseSearchJson: parseSearchJson,
      parseSearchIndexText: parseSearchIndexText,
      normalizeSiteUrl: normalizeSiteUrl,
      searchEntries: searchEntries,
      getRecommendedEntries: getRecommendedEntries,
      recommendationScore: recommendationScore,
      getReadingProgress: getReadingProgress,
      goRandomPost: goRandomPost,
      goRecommendedPost: goRecommendedPost,
      getDebugState: getDebugState,
      isLaunchPending: isLaunchPending,
      suspendForLaunch: suspendForLaunch,
      resumeFromLaunch: resumeFromLaunch,
      bootWhenLaunchReady: bootWhenLaunchReady,
      say: say
    }
    return
  }

  bindLaunchLifecycle()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWhenLaunchReady)
  } else {
    bootWhenLaunchReady()
  }
})()
