/**
 * dynamic-blog.js
 * 文章页动态交互层：阅读量、点赞、评论（匿名 + 登录入口）
 */
;(function () {
  'use strict'

  var PANEL_ID = 'dynamic-blog-panel'
  var API_BASE_DEFAULT = '/api/v1'
  var VIEW_TTL_MS = 6 * 60 * 60 * 1000
  var ANON_ID_KEY = 'dynamic_blog_anon_id'
  var TOKEN_KEY = 'dynamic_blog_token'

  function getMeta (name) {
    var el = document.querySelector('meta[name="' + name + '"]')
    return el ? el.content : ''
  }

  function getApiBase () {
    var raw = getMeta('dynamic-api-base') || API_BASE_DEFAULT
    return raw.replace(/\/+$/, '')
  }

  function hydrateTokenFromUrl () {
    try {
      var url = new URL(window.location.href)
      var token = url.searchParams.get('db_token')
      if (token) {
        localStorage.setItem(TOKEN_KEY, token)
        url.searchParams.delete('db_token')
        window.history.replaceState({}, '', url.toString())
      }
    } catch (_) {}
  }

  function getAuthToken () {
    try { return localStorage.getItem(TOKEN_KEY) || '' } catch (_) { return '' }
  }

  function ensureAnonId () {
    try {
      var existing = localStorage.getItem(ANON_ID_KEY)
      if (existing) return existing
      var id = 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      localStorage.setItem(ANON_ID_KEY, id)
      return id
    } catch (_) {
      return 'anon_fallback'
    }
  }

  function getSlug () {
    var path = (window.location.pathname || '/').replace(/\/+$/, '')
    if (!path || path === '/index.html') return ''
    return path.replace(/^\/+/, '')
  }

  function isPostPage () {
    return !!document.querySelector('#post')
  }

  function escapeHtml (str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function injectStyleOnce () {
    if (document.getElementById('dynamic-blog-style')) return
    var style = document.createElement('style')
    style.id = 'dynamic-blog-style'
    style.textContent =
      '#' + PANEL_ID + ' { margin-top: 24px; padding: 16px; border: 1px solid var(--style-border, #ddd); border-radius: 10px; background: var(--card-bg, #fff); }' +
      '#' + PANEL_ID + ' .db-metrics { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }' +
      '#' + PANEL_ID + ' .db-badge { padding: 4px 10px; border-radius: 999px; background: rgba(73,177,245,.12); }' +
      '#' + PANEL_ID + ' .db-like-btn { border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer; background: #49b1f5; color: #fff; }' +
      '#' + PANEL_ID + ' .db-like-btn.liked { background: #ff7242; }' +
      '#' + PANEL_ID + ' .db-comments { margin-top: 14px; }' +
      '#' + PANEL_ID + ' .db-comment-item { padding: 10px 0; border-top: 1px dashed var(--style-border, #ddd); }' +
      '#' + PANEL_ID + ' .db-comment-meta { font-size: 12px; opacity: .75; margin-bottom: 4px; }' +
      '#' + PANEL_ID + ' .db-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }' +
      '#' + PANEL_ID + ' .db-form-row input, #' + PANEL_ID + ' textarea { width: 100%; border: 1px solid var(--style-border, #ddd); border-radius: 8px; padding: 8px; background: transparent; color: inherit; }' +
      '#' + PANEL_ID + ' textarea { min-height: 92px; resize: vertical; margin-top: 8px; }' +
      '#' + PANEL_ID + ' .db-form-actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; }' +
      '#' + PANEL_ID + ' .db-submit-btn { border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; background: #00c4b6; color: #fff; }' +
      '#' + PANEL_ID + ' .db-login-link { font-size: 12px; }' +
      '@media (max-width: 768px) { #' + PANEL_ID + ' .db-form-row { grid-template-columns: 1fr; } }'
    document.head.appendChild(style)
  }

  function jsonFetch (url, opts) {
    var options = opts || {}
    var headers = {
      'Content-Type': 'application/json',
      'X-Anon-Id': ensureAnonId()
    }
    var token = getAuthToken()
    if (token) headers.Authorization = 'Bearer ' + token
    options.headers = Object.assign(headers, options.headers || {})
    return fetch(url, options).then(function (res) {
      return res.json().catch(function () { return {} }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body.error || ('HTTP ' + res.status))
          err.status = res.status
          throw err
        }
        return body
      })
    })
  }

  function shouldSendView (slug) {
    try {
      var key = 'db_view_' + slug
      var ts = parseInt(localStorage.getItem(key) || '0', 10)
      if (Date.now() - ts < VIEW_TTL_MS) return false
      localStorage.setItem(key, String(Date.now()))
      return true
    } catch (_) {
      return true
    }
  }

  function renderPanel (root) {
    root.innerHTML =
      '<h3>互动</h3>' +
      '<div class="db-metrics">' +
        '<span class="db-badge">阅读 <strong id="db-views">0</strong></span>' +
        '<span class="db-badge">点赞 <strong id="db-likes">0</strong></span>' +
        '<span class="db-badge">评论 <strong id="db-comments-count">0</strong></span>' +
        '<button id="db-like-btn" class="db-like-btn" type="button">点赞</button>' +
      '</div>' +
      '<div class="db-comments">' +
        '<h4>评论</h4>' +
        '<div id="db-comment-list">加载中...</div>' +
        '<form id="db-comment-form">' +
          '<div class="db-form-row">' +
            '<input id="db-nickname" name="nickname" maxlength="40" placeholder="昵称（必填）" required />' +
            '<input id="db-email" name="email" maxlength="80" placeholder="邮箱（可选，仅用于头像hash）" />' +
          '</div>' +
          '<textarea id="db-content" name="content" minlength="2" maxlength="1200" placeholder="写下你的评论..." required></textarea>' +
          '<div id="db-turnstile" class="cf-turnstile"></div>' +
          '<div class="db-form-actions">' +
            '<button class="db-submit-btn" type="submit">发布评论</button>' +
            '<a id="db-login-link" class="db-login-link" href="#" rel="nofollow">GitHub 登录（可选）</a>' +
            '<span id="db-msg"></span>' +
          '</div>' +
        '</form>' +
      '</div>'
  }

  function renderComments (listEl, comments) {
    if (!comments || !comments.length) {
      listEl.innerHTML = '<p>还没有评论，来抢沙发吧。</p>'
      return
    }
    var html = ''
    comments.forEach(function (c) {
      html +=
        '<div class="db-comment-item">' +
          '<div class="db-comment-meta">' + escapeHtml(c.nickname || '匿名') + ' · ' + escapeHtml(c.created_at || '') + '</div>' +
          '<div class="db-comment-content">' + escapeHtml(c.content || '') + '</div>' +
        '</div>'
    })
    listEl.innerHTML = html
  }

  function initDynamicBlog () {
    hydrateTokenFromUrl()
    if (!isPostPage()) return
    var slug = getSlug()
    if (!slug) return

    var existed = document.getElementById(PANEL_ID)
    if (existed) existed.remove()

    var target = document.querySelector('#post-comment') || document.querySelector('#article-container')
    if (!target) return

    injectStyleOnce()

    var panel = document.createElement('section')
    panel.id = PANEL_ID
    renderPanel(panel)
    target.parentNode.insertBefore(panel, target.nextSibling)

    var apiBase = getApiBase()
    var safeSlug = encodeURIComponent(slug)

    var viewsEl = document.getElementById('db-views')
    var likesEl = document.getElementById('db-likes')
    var commentsCountEl = document.getElementById('db-comments-count')
    var likeBtn = document.getElementById('db-like-btn')
    var commentListEl = document.getElementById('db-comment-list')
    var commentForm = document.getElementById('db-comment-form')
    var msgEl = document.getElementById('db-msg')
    var loginLink = document.getElementById('db-login-link')
    var turnstileWrap = document.getElementById('db-turnstile')

    if (loginLink) {
      loginLink.href = apiBase + '/auth/github/start?redirect=' + encodeURIComponent(window.location.href)
    }

    var turnstileSiteKey = getMeta('turnstile-site-key')
    if (turnstileSiteKey && turnstileWrap) {
      turnstileWrap.setAttribute('data-sitekey', turnstileSiteKey)
    } else if (turnstileWrap) {
      turnstileWrap.style.display = 'none'
    }

    function loadMetrics () {
      return jsonFetch(apiBase + '/posts/' + safeSlug + '/metrics').then(function (data) {
        viewsEl.textContent = String(data.views || 0)
        likesEl.textContent = String(data.likes || 0)
        commentsCountEl.textContent = String(data.comments || 0)
        likeBtn.classList.toggle('liked', !!data.likedByMe)
        likeBtn.textContent = data.likedByMe ? '已点赞' : '点赞'
      }).catch(function () {})
    }

    function loadComments () {
      return jsonFetch(apiBase + '/posts/' + safeSlug + '/comments').then(function (data) {
        renderComments(commentListEl, data.comments || [])
      }).catch(function (err) {
        commentListEl.innerHTML = '<p>评论加载失败：' + escapeHtml(err.message) + '</p>'
      })
    }

    if (shouldSendView(slug)) {
      jsonFetch(apiBase + '/posts/' + safeSlug + '/view', { method: 'POST' }).catch(function () {})
    }

    likeBtn.addEventListener('click', function () {
      jsonFetch(apiBase + '/posts/' + safeSlug + '/like', {
        method: 'POST',
        body: JSON.stringify({ action: 'toggle' })
      }).then(function (data) {
        likesEl.textContent = String(data.likes || 0)
        likeBtn.classList.toggle('liked', !!data.liked)
        likeBtn.textContent = data.liked ? '已点赞' : '点赞'
      }).catch(function (err) {
        msgEl.textContent = err.message || '点赞失败'
      })
    })

    commentForm.addEventListener('submit', function (e) {
      e.preventDefault()
      msgEl.textContent = ''
      var nickname = (document.getElementById('db-nickname').value || '').trim()
      var email = (document.getElementById('db-email').value || '').trim()
      var content = (document.getElementById('db-content').value || '').trim()
      var turnstileResponseEl = document.querySelector('[name="cf-turnstile-response"]')
      var turnstileToken = turnstileResponseEl ? turnstileResponseEl.value : ''
      if (!nickname || !content) {
        msgEl.textContent = '昵称和评论内容不能为空'
        return
      }

      jsonFetch(apiBase + '/posts/' + safeSlug + '/comments', {
        method: 'POST',
        body: JSON.stringify({
          nickname: nickname,
          email: email,
          content: content,
          turnstileToken: turnstileToken
        })
      }).then(function () {
        document.getElementById('db-content').value = ''
        msgEl.textContent = '评论已提交，等待审核后展示'
        return Promise.all([loadMetrics(), loadComments()])
      }).catch(function (err) {
        msgEl.textContent = err.message || '评论提交失败'
      })
    })

    loadMetrics()
    loadComments()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDynamicBlog)
  } else {
    initDynamicBlog()
  }

  document.addEventListener('pjax:complete', function () {
    initDynamicBlog()
  })
})()
