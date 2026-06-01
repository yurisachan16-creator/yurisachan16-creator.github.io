/**
 * style-switcher.js — visual style preset switcher
 * Adds a rightside button and toggles html[data-style] between pixel and vereis.
 */
;(function () {
  'use strict'

  var STORAGE_KEY = 'site_style_v1'
  var DEFAULT_STYLE = 'pixel'
  var ORDER = ['pixel', 'vereis']
  var LABELS = {
    pixel: '像素风格',
    vereis: '柔和手账风'
  }

  function isValidStyle (style) {
    return ORDER.indexOf(style) >= 0
  }

  function readSavedStyle () {
    try {
      var saved = localStorage.getItem(STORAGE_KEY)
      return isValidStyle(saved) ? saved : DEFAULT_STYLE
    } catch (_) {
      return DEFAULT_STYLE
    }
  }

  function getCurrentStyle () {
    var style = document.documentElement.dataset.style
    return isValidStyle(style) ? style : readSavedStyle()
  }

  function nextStyle (style) {
    var current = isValidStyle(style) ? style : DEFAULT_STYLE
    var index = ORDER.indexOf(current)
    return ORDER[(index + 1) % ORDER.length]
  }

  function updateButtonState (style) {
    var btn = document.getElementById('style-switcher-btn')
    if (!btn) return

    var label = LABELS[style] || LABELS[DEFAULT_STYLE]
    btn.dataset.style = style
    btn.title = '当前：' + label + '，点击切换风格'
    btn.setAttribute('aria-label', '当前：' + label + '，点击切换风格')
    btn.setAttribute('aria-pressed', style === 'vereis' ? 'true' : 'false')
  }

  function applyStyle (style, persist) {
    var next = isValidStyle(style) ? style : DEFAULT_STYLE
    document.documentElement.dataset.style = next

    if (persist !== false) {
      try { localStorage.setItem(STORAGE_KEY, next) } catch (_) {}
    }

    updateButtonState(next)
    return next
  }

  function injectRightsideButton () {
    if (document.getElementById('style-switcher-btn')) return

    var show = document.getElementById('rightside-config-show')
    var goUp = document.getElementById('go-up')
    if (!show) return

    var btn = document.createElement('button')
    btn.id = 'style-switcher-btn'
    btn.type = 'button'
    btn.className = 'style-switcher-btn'
    btn.innerHTML = '<i class="fas fa-palette" aria-hidden="true"></i>'

    if (goUp) show.insertBefore(btn, goUp)
    else show.appendChild(btn)

    bindButton(btn)
    updateButtonState(getCurrentStyle())
  }

  function bindButton (btn) {
    if (!btn || btn.dataset.styleSwitcherBound === '1') return

    btn.addEventListener('click', function (event) {
      event.stopPropagation()
      applyStyle(nextStyle(getCurrentStyle()), true)
    })

    btn.dataset.styleSwitcherBound = '1'
  }

  function init () {
    applyStyle(getCurrentStyle(), false)
    injectRightsideButton()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  document.addEventListener('pjax:complete', function () {
    applyStyle(getCurrentStyle(), false)
    injectRightsideButton()
    bindButton(document.getElementById('style-switcher-btn'))
  })

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      STORAGE_KEY: STORAGE_KEY,
      DEFAULT_STYLE: DEFAULT_STYLE,
      ORDER: ORDER,
      LABELS: LABELS,
      isValidStyle: isValidStyle,
      readSavedStyle: readSavedStyle,
      getCurrentStyle: getCurrentStyle,
      nextStyle: nextStyle,
      applyStyle: applyStyle,
      injectRightsideButton: injectRightsideButton,
      bindButton: bindButton
    }
  }
})()
