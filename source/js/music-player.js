/**
 * music-player.js — 音乐播放器控制脚本
 * 侧边抽屉 UI + 原生 Audio 引擎
 * 支持本地音频文件 (mp3/ogg/wav/aac/m4a/opus/flac) 和网易云歌单双源播放
 *
 * ★ 所有 DOM 均通过 JS 动态注入，不依赖主题 pug 模板修改 ★
 * 这样 sync-themes.mjs 重置主题文件也不会影响功能
 */
;(function () {
  'use strict'

  /* ============================
     常量与枚举
     ============================ */
  var State = { IDLE: 'idle', LOADING: 'loading', PLAYING: 'playing', PAUSED: 'paused', ERROR: 'error' }
  var STORAGE_KEY = 'music_player_state'
  var RETRY_DELAYS = [2000, 4000, 8000]
  var PLAYLIST_URL = '/music/playlist.json'

  /* ============================
     工具函数
     ============================ */
  function formatTime (sec) {
    if (!sec || isNaN(sec)) return '0:00'
    var m = Math.floor(sec / 60)
    var s = Math.floor(sec % 60)
    return m + ':' + (s < 10 ? '0' : '') + s
  }

  function saveState (obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)) } catch (_) {}
  }

  function loadState () {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {} } catch (_) { return {} }
  }

  function fetchWithRetry (url, retries, delay) {
    retries = retries || 0
    delay = delay || RETRY_DELAYS
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    }).catch(function (err) {
      if (retries < delay.length) {
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(fetchWithRetry(url, retries + 1, delay)) }, delay[retries])
        })
      }
      throw err
    })
  }

  /* ============================
     createDOM — 动态注入按钮 + 抽屉
     ============================ */
  function createDOM () {
    // 如果已经注入过就跳过
    if (document.getElementById('music-drawer')) return true

    // ---------- 1. rightside 入口按钮 ----------
    injectRightsideButton()

    // ---------- 2. 遮罩层 ----------
    var mask = document.createElement('div')
    mask.id = 'music-drawer-mask'
    document.body.appendChild(mask)

    // ---------- 3. 抽屉面板 ----------
    var drawer = document.createElement('div')
    drawer.id = 'music-drawer'
    drawer.innerHTML =
      '<div class="music-drawer-header">' +
        '<span class="music-drawer-title">🎵 播放列表</span>' +
        '<div class="music-drawer-header-actions">' +
          '<select id="music-source-switch">' +
            '<option value="local">本地音乐</option>' +
            '<option value="netease">网易云</option>' +
            '<option value="both">全部</option>' +
          '</select>' +
          '<button id="music-drawer-close" title="关闭"><i class="fas fa-times"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="music-drawer-cover">' +
        '<div class="music-cover-img"><img id="music-cover-art" src="" alt="封面"></div>' +
        '<div class="music-cover-info">' +
          '<div id="music-current-title">未在播放</div>' +
          '<div id="music-current-artist">--</div>' +
        '</div>' +
      '</div>' +
      '<div class="music-drawer-progress">' +
        '<span id="music-current-time">0:00</span>' +
        '<input id="music-progress" type="range" min="0" max="100" value="0">' +
        '<span id="music-total-time">0:00</span>' +
      '</div>' +
      '<div class="music-drawer-controls">' +
        '<button id="music-order" title="顺序播放"><i class="fas fa-list-ol"></i></button>' +
        '<button id="music-prev" title="上一首"><i class="fas fa-step-backward"></i></button>' +
        '<button id="music-play" title="播放"><i class="fas fa-play"></i></button>' +
        '<button id="music-next" title="下一首"><i class="fas fa-step-forward"></i></button>' +
        '<div class="music-volume-wrapper">' +
          '<button id="music-mute" title="静音"><i class="fas fa-volume-up"></i></button>' +
          '<input id="music-volume" type="range" min="0" max="100" value="40">' +
        '</div>' +
      '</div>' +
      '<div class="music-drawer-status">' +
        '<div class="music-status-loading" style="display:none"><i class="fas fa-spinner fa-spin"></i><span>加载中...</span></div>' +
        '<div class="music-status-error" style="display:none"><i class="fas fa-exclamation-triangle"></i><span class="music-error-msg">加载失败</span><button class="music-retry-btn">重试</button></div>' +
      '</div>' +
      '<ul id="music-playlist"></ul>'

    document.body.appendChild(drawer)
    return true
  }

  /**
   * 将音乐按钮注入到 #rightside-config-show 中 #go-up 之前
   * 如果 rightside 还没渲染则退出（PJAX 切换后会重试）
   */
  function injectRightsideButton () {
    if (document.getElementById('music-player-btn')) return
    var show = document.getElementById('rightside-config-show')
    var goUp = document.getElementById('go-up')
    if (!show) return
    var btn = document.createElement('button')
    btn.id = 'music-player-btn'
    btn.type = 'button'
    btn.title = '音乐播放器'
    btn.innerHTML = '<i class="fas fa-music"></i>'
    if (goUp) {
      show.insertBefore(btn, goUp)
    } else {
      show.appendChild(btn)
    }
  }

  /* ============================
     PlaylistManager — 播放列表管理
     ============================ */
  function PlaylistManager () {
    this.localTracks = []
    this.neteaseTracks = []
    this.merged = []
    this.source = 'local'
  }

  PlaylistManager.prototype.loadLocal = function () {
    var self = this
    return fetchWithRetry(PLAYLIST_URL).then(function (data) {
      self.localTracks = Array.isArray(data) ? data : []
      return self.localTracks
    })
  }

  PlaylistManager.prototype.loadNetease = function (id) {
    if (!id) return Promise.resolve([])
    var self = this
    var url = 'https://api.i-meto.com/meting/api?server=netease&type=playlist&id=' + id
    return fetchWithRetry(url).then(function (data) {
      self.neteaseTracks = (Array.isArray(data) ? data : []).map(function (t) {
        return { title: t.name || t.title, artist: t.artist || t.author, url: t.url, cover: t.pic || t.cover, album: t.album || '' }
      })
      return self.neteaseTracks
    }).catch(function () {
      self.neteaseTracks = []
      return []
    })
  }

  PlaylistManager.prototype.merge = function () {
    var seen = {}; var merged = []
    var all = this.localTracks.concat(this.neteaseTracks)
    all.forEach(function (t) {
      var key = (t.title || '') + '|' + (t.artist || '')
      if (!seen[key]) { seen[key] = true; merged.push(t) }
    })
    this.merged = merged
    return merged
  }

  PlaylistManager.prototype.getList = function () {
    if (this.source === 'local') return this.localTracks
    if (this.source === 'netease') return this.neteaseTracks
    return this.merged
  }

  /* ============================
     AudioBridge — 音频引擎桥接
     ============================ */
  function AudioBridge () {
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.volume = 0.4
    this._onTimeUpdate = null
    this._onEnded = null
    this._onError = null
    this._onCanPlay = null
    this._onLoadStart = null
    this._bound = false
  }

  AudioBridge.prototype.bindEvents = function () {
    if (this._bound) return
    this._bound = true
    var self = this
    this.audio.addEventListener('timeupdate', function () { self._onTimeUpdate && self._onTimeUpdate() })
    this.audio.addEventListener('ended', function () { self._onEnded && self._onEnded() })
    this.audio.addEventListener('error', function (e) { self._onError && self._onError(e) })
    this.audio.addEventListener('canplay', function () { self._onCanPlay && self._onCanPlay() })
    this.audio.addEventListener('loadstart', function () { self._onLoadStart && self._onLoadStart() })
  }

  AudioBridge.prototype.load = function (url) {
    this.audio.src = url
    this.audio.load()
  }

  AudioBridge.prototype.play = function () { return this.audio.play() }
  AudioBridge.prototype.pause = function () { this.audio.pause() }
  AudioBridge.prototype.toggle = function () {
    if (this.audio.paused) return this.play()
    this.pause()
    return Promise.resolve()
  }
  AudioBridge.prototype.seek = function (time) { this.audio.currentTime = time }
  AudioBridge.prototype.setVolume = function (v) { this.audio.volume = Math.max(0, Math.min(1, v)) }
  AudioBridge.prototype.getVolume = function () { return this.audio.volume }
  AudioBridge.prototype.getCurrentTime = function () { return this.audio.currentTime || 0 }
  AudioBridge.prototype.getDuration = function () { return this.audio.duration || 0 }
  AudioBridge.prototype.isPaused = function () { return this.audio.paused }

  AudioBridge.prototype.canPlayType = function (mime) {
    return this.audio.canPlayType(mime) !== ''
  }

  /* ============================
     DrawerController — UI 控制器
     ============================ */
  function DrawerController (opts) {
    this.playlist = opts.playlist
    this.bridge = opts.bridge
    this.currentIndex = 0
    this.state = State.IDLE
    this.order = 'list' // 'list' or 'random'
    this.isOpen = false
    this._animFrame = null

    // DOM 引用
    this.els = {}
    this._cacheDom()
    this._bindBridgeEvents()
    this._bindUIEvents()
    this._restoreState()
    this._renderPlaylist()
  }

  DrawerController.prototype._cacheDom = function () {
    this.els.drawer = document.getElementById('music-drawer')
    this.els.mask = document.getElementById('music-drawer-mask')
    this.els.closeBtn = document.getElementById('music-drawer-close')
    this.els.openBtn = document.getElementById('music-player-btn')
    this.els.playBtn = document.getElementById('music-play')
    this.els.prevBtn = document.getElementById('music-prev')
    this.els.nextBtn = document.getElementById('music-next')
    this.els.orderBtn = document.getElementById('music-order')
    this.els.muteBtn = document.getElementById('music-mute')
    this.els.progress = document.getElementById('music-progress')
    this.els.volume = document.getElementById('music-volume')
    this.els.currentTime = document.getElementById('music-current-time')
    this.els.totalTime = document.getElementById('music-total-time')
    this.els.title = document.getElementById('music-current-title')
    this.els.artist = document.getElementById('music-current-artist')
    this.els.coverArt = document.getElementById('music-cover-art')
    this.els.playlistUl = document.getElementById('music-playlist')
    this.els.sourceSwitch = document.getElementById('music-source-switch')
    this.els.statusLoading = this.els.drawer ? this.els.drawer.querySelector('.music-status-loading') : null
    this.els.statusError = this.els.drawer ? this.els.drawer.querySelector('.music-status-error') : null
    this.els.errorMsg = this.els.drawer ? this.els.drawer.querySelector('.music-error-msg') : null
    this.els.retryBtn = this.els.drawer ? this.els.drawer.querySelector('.music-retry-btn') : null
  }

  DrawerController.prototype._bindBridgeEvents = function () {
    var self = this
    this.bridge.bindEvents()

    this.bridge._onTimeUpdate = function () {
      var cur = self.bridge.getCurrentTime()
      var dur = self.bridge.getDuration()
      if (self.els.currentTime) self.els.currentTime.textContent = formatTime(cur)
      if (self.els.totalTime) self.els.totalTime.textContent = formatTime(dur)
      if (self.els.progress && dur) self.els.progress.value = (cur / dur * 100).toFixed(1)
      self._persistPosition()
    }

    this.bridge._onEnded = function () { self.next() }

    this.bridge._onError = function () {
      self._setState(State.ERROR)
      // Auto-skip after a short delay if the track can't be played
      var list = self.playlist.getList()
      if (list.length > 1) {
        setTimeout(function () {
          if (self.state === State.ERROR) self.next()
        }, 3000)
      }
    }

    this.bridge._onCanPlay = function () {
      if (self.state === State.LOADING) self._setState(State.PAUSED)
    }

    this.bridge._onLoadStart = function () {
      self._setState(State.LOADING)
    }
  }

  DrawerController.prototype._bindUIEvents = function () {
    var self = this

    // 抽屉 开/关
    if (this.els.openBtn) {
      this.els.openBtn.addEventListener('click', function (e) {
        e.stopPropagation()
        self.toggleDrawer()
      })
    }
    if (this.els.closeBtn) this.els.closeBtn.addEventListener('click', function () { self.closeDrawer() })
    if (this.els.mask) this.els.mask.addEventListener('click', function () { self.closeDrawer() })

    // 播放控制
    if (this.els.playBtn) this.els.playBtn.addEventListener('click', function () { self.togglePlay() })
    if (this.els.prevBtn) this.els.prevBtn.addEventListener('click', function () { self.prev() })
    if (this.els.nextBtn) this.els.nextBtn.addEventListener('click', function () { self.next() })

    // 播放顺序
    if (this.els.orderBtn) {
      this.els.orderBtn.addEventListener('click', function () {
        self.order = self.order === 'list' ? 'random' : 'list'
        self._updateOrderIcon()
        saveState(Object.assign(loadState(), { order: self.order }))
      })
    }

    // 进度条
    if (this.els.progress) {
      this.els.progress.addEventListener('input', function () {
        var dur = self.bridge.getDuration()
        if (dur) self.bridge.seek(dur * this.value / 100)
      })
    }

    // 音量
    if (this.els.volume) {
      this.els.volume.addEventListener('input', function () {
        var v = this.value / 100
        self.bridge.setVolume(v)
        self._updateVolumeIcon(v)
        saveState(Object.assign(loadState(), { volume: v }))
      })
    }

    // 静音
    if (this.els.muteBtn) {
      this.els.muteBtn.addEventListener('click', function () {
        var vol = self.bridge.getVolume()
        if (vol > 0) {
          self._prevVolume = vol
          self.bridge.setVolume(0)
          if (self.els.volume) self.els.volume.value = 0
          self._updateVolumeIcon(0)
        } else {
          var restore = self._prevVolume || 0.4
          self.bridge.setVolume(restore)
          if (self.els.volume) self.els.volume.value = restore * 100
          self._updateVolumeIcon(restore)
        }
      })
    }

    // 音频源切换
    if (this.els.sourceSwitch) {
      this.els.sourceSwitch.addEventListener('change', function () {
        self.playlist.source = this.value
        self._renderPlaylist()
        self.currentIndex = 0
        var list = self.playlist.getList()
        if (list.length) self.loadTrack(0)
      })
    }

    // 重试按钮
    if (this.els.retryBtn) {
      this.els.retryBtn.addEventListener('click', function () {
        self._loadPlaylists()
      })
    }

    // 播放列表点击
    if (this.els.playlistUl) {
      this.els.playlistUl.addEventListener('click', function (e) {
        var li = e.target.closest('li')
        if (li && li.dataset.index !== undefined) {
          self.loadTrack(parseInt(li.dataset.index, 10))
          self.play()
        }
      })
    }

    // 键盘快捷键（抽屉打开时）
    document.addEventListener('keydown', function (e) {
      if (!self.isOpen) return
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault(); self.togglePlay()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault(); self.bridge.seek(Math.max(0, self.bridge.getCurrentTime() - 5))
      } else if (e.code === 'ArrowRight') {
        e.preventDefault(); self.bridge.seek(Math.min(self.bridge.getDuration(), self.bridge.getCurrentTime() + 5))
      }
    })
  }

  /* --- Drawer 开关 --- */
  DrawerController.prototype.openDrawer = function () {
    this.isOpen = true
    if (this.els.drawer) this.els.drawer.classList.add('open')
    if (this.els.mask) this.els.mask.classList.add('open')
    document.body.style.overflow = 'hidden'
  }

  DrawerController.prototype.closeDrawer = function () {
    this.isOpen = false
    if (this.els.drawer) this.els.drawer.classList.remove('open')
    if (this.els.mask) this.els.mask.classList.remove('open')
    document.body.style.overflow = ''
  }

  DrawerController.prototype.toggleDrawer = function () {
    this.isOpen ? this.closeDrawer() : this.openDrawer()
  }

  /* --- 播放控制 --- */
  DrawerController.prototype.loadTrack = function (index) {
    var list = this.playlist.getList()
    if (!list.length) return
    index = ((index % list.length) + list.length) % list.length
    this.currentIndex = index
    var track = list[index]

    // 检查音频格式兼容性
    if (track.url) {
      var formatMap = {
        '.mp3': 'audio/mpeg',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.aac': 'audio/aac',
        '.m4a': 'audio/mp4',
        '.opus': 'audio/opus',
        '.flac': 'audio/flac'
      }
      var ext = track.url.substring(track.url.lastIndexOf('.')).toLowerCase()
      var mime = formatMap[ext]
      if (mime && !this.bridge.canPlayType(mime)) {
        console.warn('[MusicPlayer] Browser cannot play ' + ext + ' format, skipping:', track.title)
        this._setState(State.ERROR)
        return
      }
    }

    this.bridge.load(track.url)
    this._updateTrackInfo(track)
    this._highlightCurrent()
    this._persistPosition()
  }

  DrawerController.prototype.play = function () {
    var self = this
    this.bridge.play().then(function () {
      self._setState(State.PLAYING)
    }).catch(function () {
      // 浏览器自动播放策略阻止
      self._setState(State.PAUSED)
    })
  }

  DrawerController.prototype.pause = function () {
    this.bridge.pause()
    this._setState(State.PAUSED)
  }

  DrawerController.prototype.togglePlay = function () {
    if (this.state === State.IDLE) {
      var list = this.playlist.getList()
      if (list.length) { this.loadTrack(0); this.play() }
      return
    }
    if (this.bridge.isPaused()) this.play()
    else this.pause()
  }

  DrawerController.prototype.prev = function () {
    this.loadTrack(this.currentIndex - 1)
    this.play()
  }

  DrawerController.prototype.next = function () {
    var list = this.playlist.getList()
    if (this.order === 'random' && list.length > 1) {
      var next
      do { next = Math.floor(Math.random() * list.length) } while (next === this.currentIndex)
      this.loadTrack(next)
    } else {
      this.loadTrack(this.currentIndex + 1)
    }
    this.play()
  }

  /* --- 状态管理 --- */
  DrawerController.prototype._setState = function (state) {
    this.state = state
    this._updatePlayIcon()
    this._updateStatusUI()
    this._updateRightsideIcon()
  }

  DrawerController.prototype._updatePlayIcon = function () {
    if (!this.els.playBtn) return
    var icon = this.els.playBtn.querySelector('i')
    if (!icon) return
    icon.className = this.state === State.PLAYING ? 'fas fa-pause' : 'fas fa-play'
  }

  DrawerController.prototype._updateStatusUI = function () {
    if (this.els.statusLoading) this.els.statusLoading.style.display = this.state === State.LOADING ? '' : 'none'
    if (this.els.statusError) this.els.statusError.style.display = this.state === State.ERROR ? '' : 'none'
  }

  DrawerController.prototype._updateRightsideIcon = function () {
    if (!this.els.openBtn) return
    if (this.state === State.PLAYING) {
      this.els.openBtn.classList.add('playing')
    } else {
      this.els.openBtn.classList.remove('playing')
    }
  }

  DrawerController.prototype._updateOrderIcon = function () {
    if (!this.els.orderBtn) return
    var icon = this.els.orderBtn.querySelector('i')
    if (!icon) return
    icon.className = this.order === 'random' ? 'fas fa-random' : 'fas fa-list-ol'
    this.els.orderBtn.title = this.order === 'random' ? '随机播放' : '顺序播放'
  }

  DrawerController.prototype._updateVolumeIcon = function (v) {
    if (!this.els.muteBtn) return
    var icon = this.els.muteBtn.querySelector('i')
    if (!icon) return
    if (v <= 0) icon.className = 'fas fa-volume-mute'
    else if (v < 0.5) icon.className = 'fas fa-volume-down'
    else icon.className = 'fas fa-volume-up'
  }

  DrawerController.prototype._updateTrackInfo = function (track) {
    if (this.els.title) this.els.title.textContent = track.title || '未知曲目'
    if (this.els.artist) this.els.artist.textContent = track.artist || '未知艺术家'
    if (this.els.coverArt && track.cover) this.els.coverArt.src = track.cover
  }

  /* --- 播放列表渲染 --- */
  DrawerController.prototype._renderPlaylist = function () {
    if (!this.els.playlistUl) return
    var list = this.playlist.getList()
    var html = ''
    for (var i = 0; i < list.length; i++) {
      var t = list[i]
      html += '<li data-index="' + i + '" class="music-playlist-item' +
        (i === this.currentIndex ? ' active' : '') +
        '"><span class="music-pl-index">' + (i + 1) + '</span>' +
        '<span class="music-pl-title">' + (t.title || '') + '</span>' +
        '<span class="music-pl-artist">' + (t.artist || '') + '</span></li>'
    }
    this.els.playlistUl.innerHTML = html
  }

  DrawerController.prototype._highlightCurrent = function () {
    if (!this.els.playlistUl) return
    var items = this.els.playlistUl.querySelectorAll('li')
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === this.currentIndex)
    }
    // 滚动到可见
    var active = this.els.playlistUl.querySelector('li.active')
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  /* --- 持久化 --- */
  DrawerController.prototype._persistPosition = function () {
    saveState(Object.assign(loadState(), {
      index: this.currentIndex,
      time: this.bridge.getCurrentTime(),
      volume: this.bridge.getVolume(),
      order: this.order,
      source: this.playlist.source
    }))
  }

  DrawerController.prototype._restoreState = function () {
    var s = loadState()
    if (s.volume !== undefined) {
      this.bridge.setVolume(s.volume)
      if (this.els.volume) this.els.volume.value = s.volume * 100
      this._updateVolumeIcon(s.volume)
    }
    if (s.order) {
      this.order = s.order
      this._updateOrderIcon()
    }
    if (s.source && this.els.sourceSwitch) {
      this.playlist.source = s.source
      this.els.sourceSwitch.value = s.source
    }
    // Track & position restored after playlists load
    this._savedIndex = s.index || 0
    this._savedTime = s.time || 0
  }

  DrawerController.prototype._restoreTrack = function () {
    var list = this.playlist.getList()
    if (!list.length) return
    var idx = Math.min(this._savedIndex || 0, list.length - 1)
    this.loadTrack(idx)
    if (this._savedTime > 0) {
      var self = this
      // Wait for canplay to seek
      var onReady = function () {
        self.bridge.seek(self._savedTime)
        self.bridge.audio.removeEventListener('canplay', onReady)
      }
      this.bridge.audio.addEventListener('canplay', onReady)
    }
  }

  /* --- 初始化加载 --- */
  DrawerController.prototype._loadPlaylists = function () {
    var self = this
    this._setState(State.LOADING)

    var promises = [this.playlist.loadLocal()]
    // 网易云歌单（如果配置了）
    var configEl = document.querySelector('meta[name="music-netease-id"]')
    var neteaseId = configEl ? configEl.content : ''
    if (neteaseId) promises.push(this.playlist.loadNetease(neteaseId))

    Promise.all(promises).then(function () {
      self.playlist.merge()
      self._renderPlaylist()
      self._restoreTrack()
      self._setState(State.IDLE)
    }).catch(function (err) {
      console.error('[MusicPlayer] Failed to load playlists:', err)
      if (self.els.errorMsg) self.els.errorMsg.textContent = '加载播放列表失败'
      self._setState(State.ERROR)
    })
  }

  /* ============================
     初始化入口
     ============================ */
  function init () {
    // 动态创建所有 DOM（按钮 + 抽屉 + 遮罩）
    createDOM()

    // 确认 DOM 注入成功
    if (!document.getElementById('music-drawer')) {
      console.warn('[MusicPlayer] DOM creation failed, aborting init')
      return
    }

    var pm = new PlaylistManager()
    var bridge = new AudioBridge()
    var ctrl = new DrawerController({ playlist: pm, bridge: bridge })
    ctrl._loadPlaylists()

    // 暴露给全局以便调试
    window.__musicPlayer = { ctrl: ctrl, playlist: pm, bridge: bridge }
  }

  // DOMContentLoaded 或立即执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  // PJAX 兼容 — 页面切换后重新注入 rightside 按钮
  document.addEventListener('pjax:complete', function () {
    // 抽屉和遮罩在 body 层级，PJAX 不会替换它们
    // 但 rightside 按钮可能被替换，重新注入
    injectRightsideButton()

    var ctrl = window.__musicPlayer && window.__musicPlayer.ctrl
    if (ctrl) {
      ctrl.els.openBtn = document.getElementById('music-player-btn')
      if (ctrl.els.openBtn) {
        ctrl.els.openBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          ctrl.toggleDrawer()
        })
        ctrl._updateRightsideIcon()
      }
    }
  })

  // 导出给测试用
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PlaylistManager: PlaylistManager, AudioBridge: AudioBridge, DrawerController: DrawerController, State: State, formatTime: formatTime, fetchWithRetry: fetchWithRetry, createDOM: createDOM, injectRightsideButton: injectRightsideButton }
  }
})()
