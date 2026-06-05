/**
 * reading-memory.js
 * Local-only reading history and saved posts. No backend, no account, no secrets.
 */
;(function () {
  'use strict'

  var STORAGE_KEY = 'reading_memory_v1'
  var DRAWER_ID = 'reading-memory-drawer'
  var MASK_ID = 'reading-memory-mask'
  var BUTTON_ID = 'reading-memory-btn'
  var INLINE_ID = 'reading-memory-inline'
  var MAX_HISTORY = 30
  var MAX_SAVED = 80
  var globalEventsBound = false

  function readState () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      var parsed = raw ? JSON.parse(raw) : {}
      return {
        saved: Array.isArray(parsed.saved) ? parsed.saved : [],
        history: Array.isArray(parsed.history) ? parsed.history : []
      }
    } catch (_) {
      return { saved: [], history: [] }
    }
  }

  function writeState (state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        saved: normalizeList(state.saved).slice(0, MAX_SAVED),
        history: normalizeList(state.history).slice(0, MAX_HISTORY)
      }))
    } catch (_) {}
  }

  function normalizeList (items) {
    var seen = {}
    return (Array.isArray(items) ? items : []).map(normalizeEntry).filter(function (entry) {
      if (!entry.url || seen[entry.url]) return false
      seen[entry.url] = true
      return true
    })
  }

  function normalizeEntry (entry) {
    entry = entry || {}
    return {
      title: stripText(entry.title) || '未命名文章',
      url: normalizeUrl(entry.url),
      date: stripText(entry.date),
      savedAt: stripText(entry.savedAt),
      readAt: stripText(entry.readAt),
      progress: clampPercent(entry.progress)
    }
  }

  function normalizeUrl (url) {
    var raw = String(url || '').trim()
    if (!raw) return ''
    try {
      var parsed = new URL(raw, window.location.origin)
      return parsed.pathname.replace(/\/index\.html$/, '/')
    } catch (_) {
      return raw.charAt(0) === '/' ? raw : '/' + raw
    }
  }

  function stripText (value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
  }

  function clampPercent (value) {
    var parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.min(100, Math.round(parsed)))
  }

  function getReadingProgress () {
    var target = document.querySelector('.post-content, #article-container, article, #content-inner')
    var rect = target ? target.getBoundingClientRect() : null
    var scrollTop = window.scrollY || document.documentElement.scrollTop || 0
    var total = Math.max(1, (target ? target.scrollHeight + Math.max(0, scrollTop + rect.top) : document.documentElement.scrollHeight) - window.innerHeight)
    var value = target ? Math.max(0, -rect.top) : scrollTop
    return clampPercent(value / total * 100)
  }

  function isPostPage () {
    return !!document.querySelector('#post')
  }

  function getCurrentEntry () {
    if (!isPostPage()) return null
    var titleNode = document.querySelector('#article-title, .post-title, h1')
    var title = titleNode ? stripText(titleNode.textContent) : stripText(document.title.split('|')[0])
    return {
      title: title,
      url: normalizeUrl(window.location.pathname),
      date: new Date().toISOString().slice(0, 10),
      readAt: new Date().toISOString(),
      progress: getReadingProgress()
    }
  }

  function recordHistory (entry) {
    var normalized = normalizeEntry(entry)
    if (!normalized.url) return false
    var state = readState()
    state.history = [normalized].concat(state.history.filter(function (item) {
      return normalizeUrl(item.url) !== normalized.url
    }))
    writeState(state)
    return true
  }

  function hasSaved (url) {
    var normalizedUrl = normalizeUrl(url)
    return readState().saved.some(function (item) {
      return normalizeUrl(item.url) === normalizedUrl
    })
  }

  function toggleSaved (entry) {
    var normalized = normalizeEntry(entry)
    if (!normalized.url) return false
    var state = readState()
    var exists = hasSaved(normalized.url)
    if (exists) {
      state.saved = state.saved.filter(function (item) {
        return normalizeUrl(item.url) !== normalized.url
      })
    } else {
      normalized.savedAt = new Date().toISOString()
      state.saved = [normalized].concat(state.saved)
    }
    writeState(state)
    renderInlinePanel()
    renderDrawer(getActiveTab())
    return !exists
  }

  function getActiveTab () {
    var selected = document.querySelector('#' + DRAWER_ID + ' [aria-selected="true"]')
    return selected ? selected.dataset.readingMemoryTab : 'saved'
  }

  function injectRightsideButton () {
    if (document.getElementById(BUTTON_ID)) return
    var show = document.getElementById('rightside-config-show')
    if (!show) return
    var btn = document.createElement('button')
    btn.id = BUTTON_ID
    btn.type = 'button'
    btn.title = '稍后读'
    btn.setAttribute('aria-label', '打开稍后读和阅读历史')
    btn.setAttribute('aria-controls', DRAWER_ID)
    btn.setAttribute('aria-expanded', 'false')
    btn.innerHTML = '<i class="fas fa-bookmark"></i>'
    btn.addEventListener('click', function () {
      openDrawer('saved')
    })

    var goUp = document.getElementById('go-up')
    if (goUp) show.insertBefore(btn, goUp)
    else show.appendChild(btn)
  }

  function ensureDrawer () {
    var mask = document.getElementById(MASK_ID)
    if (!mask) {
      mask = document.createElement('div')
      mask.id = MASK_ID
      mask.hidden = true
      mask.addEventListener('click', closeDrawer)
      document.body.appendChild(mask)
    }

    var drawer = document.getElementById(DRAWER_ID)
    if (!drawer) {
      drawer = document.createElement('aside')
      drawer.id = DRAWER_ID
      drawer.hidden = true
      drawer.setAttribute('aria-label', '稍后读和阅读历史')
      document.body.appendChild(drawer)
    }

    return drawer
  }

  function openDrawer (tab) {
    var drawer = ensureDrawer()
    var mask = document.getElementById(MASK_ID)
    renderDrawer(tab || 'saved')
    drawer.hidden = false
    if (mask) mask.hidden = false
    setDrawerExpanded(true)
  }

  function closeDrawer () {
    var drawer = document.getElementById(DRAWER_ID)
    var mask = document.getElementById(MASK_ID)
    if (drawer) drawer.hidden = true
    if (mask) mask.hidden = true
    setDrawerExpanded(false)
  }

  function setDrawerExpanded (expanded) {
    var btn = document.getElementById(BUTTON_ID)
    if (btn) btn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  }

  function renderDrawer (tab) {
    var drawer = ensureDrawer()
    var state = readState()
    var active = tab === 'history' ? 'history' : 'saved'
    var list = active === 'history' ? state.history : state.saved
    drawer.innerHTML = [
      '<div class="reading-memory-header">',
        '<strong>阅读记录</strong>',
        '<button type="button" class="reading-memory-button secondary" data-reading-memory-close><i class="fas fa-times"></i></button>',
      '</div>',
      '<div class="reading-memory-tabs" role="tablist">',
        '<button type="button" role="tab" data-reading-memory-tab="saved" aria-selected="' + String(active === 'saved') + '">稍后读 ' + state.saved.length + '</button>',
        '<button type="button" role="tab" data-reading-memory-tab="history" aria-selected="' + String(active === 'history') + '">最近阅读 ' + state.history.length + '</button>',
      '</div>',
      '<div class="reading-memory-list">' + renderList(list, active) + '</div>'
    ].join('')

    bindDrawer(drawer)
  }

  function renderList (items, mode) {
    if (!items.length) return '<div class="feature-empty">' + (mode === 'history' ? '还没有阅读历史。' : '还没有稍后读。') + '</div>'
    return items.map(function (item) {
      var time = mode === 'history' ? item.readAt : item.savedAt
      var meta = [
        time ? formatTime(time) : '',
        mode === 'history' && item.progress ? '读到 ' + item.progress + '%' : ''
      ].filter(Boolean).join(' · ')
      return [
        '<article class="reading-memory-item">',
          '<a href="' + escapeHtml(item.url) + '">' + escapeHtml(item.title) + '</a>',
          meta ? '<small>' + escapeHtml(meta) + '</small>' : '',
          mode === 'saved' ? '<button type="button" class="reading-memory-button secondary" data-reading-unsave="' + escapeHtml(item.url) + '">移出稍后读</button>' : '',
        '</article>'
      ].join('')
    }).join('')
  }

  function bindDrawer (drawer) {
    var close = drawer.querySelector('[data-reading-memory-close]')
    if (close) close.addEventListener('click', closeDrawer)

    Array.prototype.slice.call(drawer.querySelectorAll('[data-reading-memory-tab]')).forEach(function (button) {
      button.addEventListener('click', function () {
        renderDrawer(button.dataset.readingMemoryTab)
      })
    })

    Array.prototype.slice.call(drawer.querySelectorAll('[data-reading-unsave]')).forEach(function (button) {
      button.addEventListener('click', function () {
        toggleSaved({ url: button.dataset.readingUnsave, title: button.closest('.reading-memory-item').querySelector('a').textContent })
      })
    })
  }

  function renderInlinePanel () {
    if (!isPostPage()) return false
    var entry = getCurrentEntry()
    if (!entry) return false
    var existed = document.getElementById(INLINE_ID)
    if (existed) existed.remove()
    var target = document.querySelector('#article-container')
    if (!target) return false

    var saved = hasSaved(entry.url)
    var panel = document.createElement('section')
    panel.id = INLINE_ID
    panel.className = 'reading-memory-inline blog-feature-page'
    panel.innerHTML = [
      '<h3>阅读动作</h3>',
      '<div class="reading-memory-actions">',
        '<button type="button" class="reading-memory-button" data-reading-save-current>' + (saved ? '已加入稍后读' : '加入稍后读') + '</button>',
        '<button type="button" class="reading-memory-button secondary" data-reading-open-history>最近阅读</button>',
        '<a class="reading-memory-button secondary" href="/reading/">阅读路线</a>',
      '</div>'
    ].join('')
    target.parentNode.insertBefore(panel, target.nextSibling)

    var saveBtn = panel.querySelector('[data-reading-save-current]')
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var nextSaved = toggleSaved(getCurrentEntry())
        saveBtn.textContent = nextSaved ? '已加入稍后读' : '加入稍后读'
      })
    }

    var historyBtn = panel.querySelector('[data-reading-open-history]')
    if (historyBtn) {
      historyBtn.addEventListener('click', function () {
        openDrawer('history')
      })
    }
    return true
  }

  function recordCurrentPage () {
    var entry = getCurrentEntry()
    if (entry) recordHistory(entry)
  }

  function bindGlobalEvents () {
    if (globalEventsBound) return
    globalEventsBound = true
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawer()
    })
  }

  function init () {
    bindGlobalEvents()
    injectRightsideButton()
    ensureDrawer()
    recordCurrentPage()
    renderInlinePanel()
  }

  function escapeHtml (value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
    })
  }

  function formatTime (value) {
    var date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value || '')
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  document.addEventListener('pjax:complete', init)

  window.__readingMemory = {
    readState: readState,
    recordHistory: recordHistory,
    hasSaved: hasSaved,
    toggleSaved: toggleSaved,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    getCurrentEntry: getCurrentEntry
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      readState: readState,
      recordHistory: recordHistory,
      hasSaved: hasSaved,
      toggleSaved: toggleSaved,
      openDrawer: openDrawer,
      closeDrawer: closeDrawer,
      normalizeEntry: normalizeEntry,
      normalizeUrl: normalizeUrl
    }
  }
})()
