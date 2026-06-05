/**
 * comment-admin.js
 * Lightweight moderation UI for the dynamic blog Worker.
 */
;(function () {
  'use strict'

  var TOKEN_KEY = 'comment_admin_token'
  var API_BASE_DEFAULT = '/api/v1'
  var state = {
    status: 'pending',
    comments: [],
    nextCursor: null,
    loading: false
  }

  function init () {
    var root = document.getElementById('comment-admin-app')
    if (!root) return
    renderShell(root)
    bindShell(root)
    var token = readToken()
    if (token) loadComments(root, false)
  }

  function getMeta (name) {
    var el = document.querySelector('meta[name="' + name + '"]')
    return el ? el.content : ''
  }

  function getApiBase () {
    return (getMeta('dynamic-api-base') || API_BASE_DEFAULT).replace(/\/+$/, '')
  }

  function readToken () {
    try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch (_) { return '' }
  }

  function writeToken (token) {
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token)
      else sessionStorage.removeItem(TOKEN_KEY)
    } catch (_) {}
  }

  function renderShell (root) {
    root.innerHTML = [
      '<div class="comment-admin-panel">',
        '<label class="comment-admin-token">',
          '<span>管理员 Token</span>',
          '<input id="comment-admin-token" type="password" autocomplete="off" placeholder="粘贴当前管理员 JWT" value="' + escapeHtml(readToken()) + '">',
        '</label>',
        '<div class="comment-admin-actions">',
          '<label class="comment-admin-filter">',
            '<span>状态</span>',
            '<select id="comment-admin-status">',
              '<option value="pending">待审核</option>',
              '<option value="approved">已通过</option>',
              '<option value="hidden">已隐藏</option>',
              '<option value="all">全部</option>',
            '</select>',
          '</label>',
          '<button type="button" class="comment-admin-button" data-comment-admin-load>刷新</button>',
          '<button type="button" class="comment-admin-button secondary" data-comment-admin-clear>清除 Token</button>',
        '</div>',
        '<div id="comment-admin-message" class="comment-admin-meta"></div>',
        '<div id="comment-admin-list" class="comment-admin-list"></div>',
        '<div class="comment-admin-actions">',
          '<button type="button" class="comment-admin-button secondary" data-comment-admin-more hidden>加载更多</button>',
        '</div>',
      '</div>'
    ].join('')
    renderList(root)
  }

  function bindShell (root) {
    var input = root.querySelector('#comment-admin-token')
    var select = root.querySelector('#comment-admin-status')
    var loadBtn = root.querySelector('[data-comment-admin-load]')
    var clearBtn = root.querySelector('[data-comment-admin-clear]')
    var moreBtn = root.querySelector('[data-comment-admin-more]')

    if (select) {
      select.value = state.status
      select.addEventListener('change', function () {
        state.status = select.value
        loadComments(root, false)
      })
    }
    if (input) {
      input.addEventListener('input', function () {
        writeToken(input.value.trim())
      })
    }
    if (loadBtn) {
      loadBtn.addEventListener('click', function () {
        if (input) writeToken(input.value.trim())
        loadComments(root, false)
      })
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        writeToken('')
        if (input) input.value = ''
        state.comments = []
        state.nextCursor = null
        setMessage(root, 'Token 已清除。')
        renderList(root)
      })
    }
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        loadComments(root, true)
      })
    }
  }

  function loadComments (root, append) {
    var token = readToken()
    if (!token) {
      setMessage(root, '需要管理员 Token。')
      return Promise.resolve(false)
    }
    if (state.loading) return Promise.resolve(false)

    state.loading = true
    setMessage(root, '正在读取评论...')

    var url = getApiBase() + '/admin/comments?status=' + encodeURIComponent(state.status)
    if (append && state.nextCursor) url += '&cursor=' + encodeURIComponent(state.nextCursor)

    return fetch(url, {
      headers: {
        Authorization: 'Bearer ' + token
      }
    }).then(function (response) {
      return response.json().catch(function () { return {} }).then(function (body) {
        if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status))
        return body
      })
    }).then(function (data) {
      state.comments = append ? state.comments.concat(data.comments || []) : (data.comments || [])
      state.nextCursor = data.nextCursor || null
      setMessage(root, '已读取 ' + state.comments.length + ' 条评论。')
      renderList(root)
      return true
    }).catch(function (error) {
      setMessage(root, '读取失败：' + error.message)
      return false
    }).finally(function () {
      state.loading = false
    })
  }

  function moderateComment (root, id, action) {
    var token = readToken()
    if (!token) {
      setMessage(root, '需要管理员 Token。')
      return
    }
    setMessage(root, '正在提交审核操作...')
    fetch(getApiBase() + '/admin/comments/' + encodeURIComponent(id) + '/moderate', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action: action })
    }).then(function (response) {
      return response.json().catch(function () { return {} }).then(function (body) {
        if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status))
        return body
      })
    }).then(function () {
      setMessage(root, '审核操作已完成。')
      return loadComments(root, false)
    }).catch(function (error) {
      setMessage(root, '审核失败：' + error.message)
    })
  }

  function renderList (root) {
    var list = root.querySelector('#comment-admin-list')
    var moreBtn = root.querySelector('[data-comment-admin-more]')
    if (!list) return
    if (!state.comments.length) {
      list.innerHTML = '<div class="feature-empty">当前状态下没有评论。</div>'
    } else {
      list.innerHTML = state.comments.map(renderComment).join('')
      Array.prototype.slice.call(list.querySelectorAll('[data-comment-action]')).forEach(function (button) {
        button.addEventListener('click', function () {
          moderateComment(root, button.dataset.commentId, button.dataset.commentAction)
        })
      })
    }
    if (moreBtn) moreBtn.hidden = !state.nextCursor
  }

  function renderComment (comment) {
    var statusLabel = {
      pending: '待审核',
      approved: '已通过',
      hidden: '已隐藏'
    }[comment.status] || comment.status
    var commentHref = normalizeCommentHref(comment.slug)

    return [
      '<article class="comment-admin-card">',
        '<div class="comment-admin-meta">',
          '#' + escapeHtml(comment.id) + ' · ' + escapeHtml(statusLabel) + ' · ' + escapeHtml(comment.nickname || '匿名'),
          '<br><a href="' + escapeHtml(commentHref) + '">' + escapeHtml(displayCommentSlug(comment.slug)) + '</a>',
          '<br>' + escapeHtml(comment.created_at || ''),
        '</div>',
        '<p class="comment-admin-content">' + escapeHtml(comment.content || '') + '</p>',
        '<div class="comment-admin-actions">',
          comment.status !== 'approved' ? '<button type="button" class="comment-admin-button" data-comment-id="' + escapeHtml(comment.id) + '" data-comment-action="approve">通过</button>' : '',
          comment.status !== 'hidden' ? '<button type="button" class="comment-admin-button secondary" data-comment-id="' + escapeHtml(comment.id) + '" data-comment-action="hide">隐藏</button>' : '',
        '</div>',
      '</article>'
    ].join('')
  }

  function normalizeCommentHref (slug) {
    var raw = String(slug || '').trim()
    if (!raw) return '/'
    raw = raw.replace(/^https?:\/\/[^/]+/i, '')
      .replace(/^\/+/, '')
      .replace(/\/+/g, '/')
    var parts = raw.split('/').filter(function (part) {
      return part && part !== '.' && part !== '..'
    }).map(function (part) {
      return encodeURIComponent(part)
    })
    if (!parts.length) return '/'
    return '/' + parts.join('/') + (raw.endsWith('/') ? '/' : '')
  }

  function displayCommentSlug (slug) {
    var href = normalizeCommentHref(slug)
    return href === '/' ? '/' : href.replace(/^\/+/, '')
  }

  function setMessage (root, message) {
    var el = root.querySelector('#comment-admin-message')
    if (el) el.textContent = message || ''
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
      renderComment: renderComment,
      normalizeCommentHref: normalizeCommentHref,
      escapeHtml: escapeHtml
    }
  }
})()
