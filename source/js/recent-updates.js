/**
 * recent-updates.js
 * Renders article revision history generated at build time.
 */
;(function () {
  'use strict'

  var DATA_URL = '/data/blog-content-index.json'

  function init () {
    var root = document.getElementById('recent-updates-app')
    if (!root) return
    fetch(DATA_URL)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
      .then(function (data) {
        render(root, data.updates || [])
      })
      .catch(function (error) {
        root.innerHTML = '<div class="feature-error">更新记录加载失败：' + escapeHtml(error.message) + '</div>'
      })
  }

  function render (root, updates) {
    var categories = collectCategories(updates)
    root.innerHTML = [
      '<div class="updates-toolbar">',
        '<button type="button" class="feature-button" data-update-filter="all">全部</button>',
        categories.map(function (category) {
          return '<button type="button" class="feature-button secondary" data-update-filter="' + escapeHtml(category) + '">' + escapeHtml(category) + '</button>'
        }).join(''),
      '</div>',
      '<div class="updates-timeline">' + renderItems(updates) + '</div>'
    ].join('')

    var list = root.querySelector('.updates-timeline')
    Array.prototype.slice.call(root.querySelectorAll('[data-update-filter]')).forEach(function (button) {
      button.addEventListener('click', function () {
        var filter = button.dataset.updateFilter
        var next = filter === 'all' ? updates : updates.filter(function (item) {
          return (item.categories || []).indexOf(filter) >= 0
        })
        list.innerHTML = renderItems(next)
      })
    })
  }

  function renderItems (updates) {
    if (!updates.length) return '<div class="feature-empty">暂时没有更新记录。</div>'
    return updates.map(function (item) {
      var category = (item.categories || [])[0] || '未分类'
      return [
        '<article class="updates-timeline-item">',
          '<small>' + escapeHtml(item.date) + ' · v' + escapeHtml(item.version) + ' · ' + escapeHtml(category) + '</small>',
          '<h3><a href="' + escapeHtml(item.url) + '">' + escapeHtml(item.title) + '</a></h3>',
          '<p>' + escapeHtml(item.summary) + '</p>',
        '</article>'
      ].join('')
    }).join('')
  }

  function collectCategories (updates) {
    var seen = {}
    updates.forEach(function (item) {
      ;(item.categories || []).forEach(function (category) {
        if (category) seen[category] = true
      })
    })
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'zh-CN') })
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
      renderItems: renderItems,
      collectCategories: collectCategories
    }
  }
})()
