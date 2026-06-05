/**
 * reading-routes.js
 * Renders generated topic routes from /data/blog-content-index.json.
 */
;(function () {
  'use strict'

  var DATA_URL = '/data/blog-content-index.json'

  function init () {
    var root = document.getElementById('reading-routes-app')
    if (!root) return
    fetch(DATA_URL)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then(function (data) {
        render(root, data.routes || [])
      })
      .catch(function (error) {
        root.innerHTML = '<div class="feature-error">阅读路线加载失败：' + escapeHtml(error.message) + '</div>'
      })
  }

  function render (root, routes) {
    if (!routes.length) {
      root.innerHTML = '<div class="feature-empty">暂时没有可用路线。</div>'
      return
    }

    root.innerHTML = [
      '<div class="reading-route-grid">',
      routes.map(renderRoute).join(''),
      '</div>'
    ].join('')

    Array.prototype.slice.call(root.querySelectorAll('[data-reading-save]')).forEach(function (button) {
      button.addEventListener('click', function () {
        var title = button.dataset.readingTitle || ''
        var url = button.dataset.readingSave || ''
        if (window.__readingMemory) {
          var saved = window.__readingMemory.toggleSaved({ title: title, url: url })
          button.textContent = saved ? '已加入稍后读' : '加入稍后读'
        }
      })
    })
  }

  function renderRoute (route) {
    var entries = route.entries || []
    var first = entries[0]
    var last = entries[entries.length - 1]
    var accent = route.accent || '#49b1f5'
    return [
      '<article class="reading-route-card" style="--route-accent:' + escapeHtml(accent) + '">',
        '<div>',
          '<h3>' + escapeHtml(route.title) + '</h3>',
          '<p>' + escapeHtml(route.summary) + '</p>',
        '</div>',
        '<div class="reading-route-meta">',
          '<span>' + entries.length + ' 篇</span>',
          route.keywords ? route.keywords.slice(0, 3).map(function (keyword) {
            return '<span>' + escapeHtml(keyword) + '</span>'
          }).join('') : '',
        '</div>',
        '<ol class="reading-route-list">',
          entries.map(renderStep).join(''),
        '</ol>',
        '<div class="feature-actions">',
          first ? '<a class="feature-button" href="' + escapeHtml(first.url) + '">从第一篇开始</a>' : '',
          last ? '<button type="button" class="feature-button secondary" data-reading-save="' + escapeHtml(last.url) + '" data-reading-title="' + escapeHtml(last.title) + '">' + savedLabel(last.url) + '</button>' : '',
        '</div>',
      '</article>'
    ].join('')
  }

  function renderStep (entry) {
    return [
      '<li class="reading-route-step">',
        '<span class="reading-route-step-num">' + escapeHtml(entry.step) + '</span>',
        '<span>',
          '<a href="' + escapeHtml(entry.url) + '">' + escapeHtml(entry.title) + '</a>',
          '<small>' + escapeHtml([entry.date, (entry.categories || []).join(' / ')].filter(Boolean).join(' · ')) + '</small>',
        '</span>',
      '</li>'
    ].join('')
  }

  function savedLabel (url) {
    return window.__readingMemory && window.__readingMemory.hasSaved(url) ? '已加入稍后读' : '稍后读最后一篇'
  }

  function escapeHtml (value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  document.addEventListener('pjax:complete', init)

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      renderRoute: renderRoute,
      renderStep: renderStep
    }
  }
})()
