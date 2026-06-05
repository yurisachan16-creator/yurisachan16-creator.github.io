/**
 * 音乐播放器单元测试
 * 测试 PlaylistManager, AudioBridge, 状态管理, 工具函数, DOM 动态注入
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 由于 music-player.js 是 IIFE + module.exports，需要动态加载
// 我们在 jsdom 环境中模拟必要 DOM 后 require
function loadModule () {
  // 清除缓存
  const modulePath = require.resolve('../../source/js/music-player.js')
  delete require.cache[modulePath]
  return require(modulePath)
}

function setupDOM () {
  const storage = createStorageMock()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  })

  document.body.innerHTML = `
    <div id="rightside">
      <div id="rightside-config-hide"></div>
      <div id="rightside-config-show">
        <button id="rightside-config" type="button"><i class="fas fa-cog"></i></button>
        <button id="music-player-btn" type="button" title="音乐播放器"><i class="fas fa-music"></i></button>
        <button id="go-up" type="button"><span class="scroll-percent"></span><i class="fas fa-arrow-up"></i></button>
      </div>
    </div>
    <div id="music-drawer-mask"></div>
    <div id="music-drawer">
      <div class="music-drawer-header">
        <span class="music-drawer-title">播放列表</span>
        <div class="music-drawer-header-actions">
          <select id="music-source-switch">
            <option value="local">本地音乐</option>
            <option value="netease">网易云</option>
            <option value="both">全部</option>
          </select>
          <button id="music-drawer-close"><i class="fas fa-times"></i></button>
        </div>
      </div>
      <div class="music-drawer-cover">
        <div class="music-cover-img"><img id="music-cover-art" src="" alt="封面"></div>
        <div class="music-cover-info">
          <div id="music-current-title">未在播放</div>
          <div id="music-current-artist">--</div>
        </div>
      </div>
      <div class="music-drawer-progress">
        <span id="music-current-time">0:00</span>
        <input id="music-progress" type="range" min="0" max="100" value="0">
        <span id="music-total-time">0:00</span>
      </div>
      <div class="music-drawer-controls">
        <button id="music-order"><i class="fas fa-list-ol"></i></button>
        <button id="music-prev"><i class="fas fa-step-backward"></i></button>
        <button id="music-play"><i class="fas fa-play"></i></button>
        <button id="music-next"><i class="fas fa-step-forward"></i></button>
        <div class="music-volume-wrapper">
          <button id="music-mute"><i class="fas fa-volume-up"></i></button>
          <input id="music-volume" type="range" min="0" max="100" value="10">
        </div>
      </div>
      <div class="music-drawer-status">
        <div class="music-status-loading" style="display:none"><i class="fas fa-spinner fa-spin"></i><span>加载中...</span></div>
        <div class="music-status-error" style="display:none"><i class="fas fa-exclamation-triangle"></i><span class="music-error-msg">加载失败</span><button class="music-retry-btn">重试</button></div>
      </div>
      <ul id="music-playlist"></ul>
    </div>
  `
}

function createStorageMock () {
  const store = {}

  return {
    getItem (key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    },
    setItem (key, value) {
      store[key] = String(value)
    },
    removeItem (key) {
      delete store[key]
    },
    clear () {
      Object.keys(store).forEach((key) => delete store[key])
    }
  }
}

/* ============================
   formatTime 工具函数
   ============================ */
describe('formatTime', () => {
  it('formats 0 seconds as 0:00', () => {
    const { formatTime } = loadModule()
    expect(formatTime(0)).toBe('0:00')
  })

  it('formats 65 seconds as 1:05', () => {
    const { formatTime } = loadModule()
    expect(formatTime(65)).toBe('1:05')
  })

  it('formats 3661 seconds as 61:01', () => {
    const { formatTime } = loadModule()
    expect(formatTime(3661)).toBe('61:01')
  })

  it('returns 0:00 for NaN', () => {
    const { formatTime } = loadModule()
    expect(formatTime(NaN)).toBe('0:00')
  })

  it('returns 0:00 for undefined', () => {
    const { formatTime } = loadModule()
    expect(formatTime(undefined)).toBe('0:00')
  })
})

/* ============================
   readConfigFromMeta
   ============================ */
describe('readConfigFromMeta', () => {
  beforeEach(() => {
    setupDOM()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('returns defaults when meta tags are missing', () => {
    const { readConfigFromMeta } = loadModule()
    const config = readConfigFromMeta()
    expect(config.source).toBe('both')
    expect(config.volume).toBe(0.1)
    expect(config.autoplayHome).toBe(false)
    expect(config.order).toBe('list')
  })

  it('reads and validates meta config values', () => {
    document.head.innerHTML = `
      <meta name="music-default-source" content="netease" />
      <meta name="music-default-volume" content="0.35" />
      <meta name="music-autoplay-home" content="false" />
      <meta name="music-default-order" content="random" />
      <meta name="music-netease-id" content="123456" />
    `
    const { readConfigFromMeta } = loadModule()
    const config = readConfigFromMeta()
    expect(config.source).toBe('netease')
    expect(config.volume).toBe(0.35)
    expect(config.autoplayHome).toBe(false)
    expect(config.order).toBe('random')
    expect(config.neteaseId).toBe('123456')
  })
})

/* ============================
   PlaylistManager
   ============================ */
describe('PlaylistManager', () => {
  let PlaylistManager

  beforeEach(() => {
    setupDOM()
    const mod = loadModule()
    PlaylistManager = mod.PlaylistManager
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('initializes with empty playlists', () => {
    const pm = new PlaylistManager()
    expect(pm.localTracks).toEqual([])
    expect(pm.neteaseTracks).toEqual([])
    expect(pm.merged).toEqual([])
    expect(pm.source).toBe('both')
  })

  it('loadLocal fetches and parses playlist.json', async () => {
    const mockData = [
      { title: 'Song A', artist: 'Artist A', url: '/music/a.flac', cover: '/img/a.jpg' }
    ]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    const pm = new PlaylistManager()
    const result = await pm.loadLocal()
    expect(result).toEqual(mockData)
    expect(pm.localTracks).toEqual(mockData)
  })

  it('loadLocal retries on failure', async () => {
    vi.useFakeTimers()
    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      callCount++
      if (callCount < 3) return Promise.reject(new Error('network'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve([{ title: 'OK' }]) })
    })

    const pm = new PlaylistManager()
    const promise = pm.loadLocal()

    // Advance past first two retry delays
    await vi.advanceTimersByTimeAsync(2000) // first retry
    await vi.advanceTimersByTimeAsync(4000) // second retry

    const result = await promise
    expect(result).toEqual([{ title: 'OK' }])
    expect(callCount).toBeGreaterThanOrEqual(3)
  })

  it('merge deduplicates tracks by title+artist', () => {
    const pm = new PlaylistManager()
    pm.localTracks = [
      { title: 'Song A', artist: 'X', url: '/a.flac' },
      { title: 'Song B', artist: 'Y', url: '/b.flac' }
    ]
    pm.neteaseTracks = [
      { title: 'Song A', artist: 'X', url: 'http://net/a.mp3' }, // duplicate
      { title: 'Song C', artist: 'Z', url: 'http://net/c.mp3' }
    ]
    const result = pm.merge()
    expect(result).toHaveLength(3)
    expect(result.map(t => t.title)).toEqual(['Song A', 'Song B', 'Song C'])
    // Local version should be kept (first seen wins)
    expect(result[0].url).toBe('/a.flac')
  })

  it('getList returns correct list based on source', () => {
    const pm = new PlaylistManager()
    pm.localTracks = [{ title: 'L' }]
    pm.neteaseTracks = [{ title: 'N' }]
    pm.merged = [{ title: 'L' }, { title: 'N' }]

    pm.source = 'local'
    expect(pm.getList()).toEqual([{ title: 'L' }])

    pm.source = 'netease'
    expect(pm.getList()).toEqual([{ title: 'N' }])

    pm.source = 'both'
    expect(pm.getList()).toEqual([{ title: 'L' }, { title: 'N' }])
  })
})

/* ============================
   AudioBridge
   ============================ */
describe('AudioBridge', () => {
  let AudioBridge

  beforeEach(() => {
    setupDOM()
    const mod = loadModule()
    AudioBridge = mod.AudioBridge
    vi.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('sets default volume to 0.1', () => {
    const ab = new AudioBridge()
    expect(ab.audio.volume).toBe(0.1)
  })

  it('setVolume clamps to 0-1', () => {
    const ab = new AudioBridge()
    ab.setVolume(-0.5)
    expect(ab.getVolume()).toBe(0)
    ab.setVolume(1.5)
    expect(ab.getVolume()).toBe(1)
    ab.setVolume(0.6)
    expect(ab.getVolume()).toBeCloseTo(0.6)
  })

  it('load sets audio src', () => {
    const ab = new AudioBridge()
    ab.load('/music/test.flac')
    expect(ab.audio.src).toContain('/music/test.flac')
  })

  it('isPaused returns true initially', () => {
    const ab = new AudioBridge()
    expect(ab.isPaused()).toBe(true)
  })

  it('bindEvents only binds once', () => {
    const ab = new AudioBridge()
    const spy = vi.spyOn(ab.audio, 'addEventListener')
    ab.bindEvents()
    ab.bindEvents() // second call should be no-op
    // 5 events bound exactly once
    expect(spy).toHaveBeenCalledTimes(5)
  })
})

/* ============================
   State 枚举
   ============================ */
describe('State', () => {
  it('has correct values', () => {
    const { State } = loadModule()
    expect(State.IDLE).toBe('idle')
    expect(State.LOADING).toBe('loading')
    expect(State.PLAYING).toBe('playing')
    expect(State.PAUSED).toBe('paused')
    expect(State.ERROR).toBe('error')
  })
})

/* ============================
   DrawerController (集成级)
   ============================ */
describe('DrawerController', () => {
  let mod

  beforeEach(() => {
    setupDOM()
    localStorage.clear()
    mod = loadModule()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('creates controller and caches DOM elements', () => {
    const pm = new mod.PlaylistManager()
    const bridge = new mod.AudioBridge()
    const ctrl = new mod.DrawerController({ playlist: pm, bridge: bridge })
    expect(ctrl.els.drawer).toBeTruthy()
    expect(ctrl.els.playBtn).toBeTruthy()
    expect(ctrl.els.playlistUl).toBeTruthy()
    expect(ctrl.state).toBe('idle')
    expect(ctrl.isOpen).toBe(false)
  })

  it('opens and closes drawer', () => {
    const pm = new mod.PlaylistManager()
    const bridge = new mod.AudioBridge()
    const ctrl = new mod.DrawerController({ playlist: pm, bridge: bridge })

    ctrl.openDrawer()
    expect(ctrl.isOpen).toBe(true)
    expect(ctrl.els.drawer.classList.contains('open')).toBe(true)
    expect(ctrl.els.mask.classList.contains('open')).toBe(true)

    ctrl.closeDrawer()
    expect(ctrl.isOpen).toBe(false)
    expect(ctrl.els.drawer.classList.contains('open')).toBe(false)
  })

  it('toggleDrawer alternates open/close', () => {
    const pm = new mod.PlaylistManager()
    const bridge = new mod.AudioBridge()
    const ctrl = new mod.DrawerController({ playlist: pm, bridge: bridge })

    ctrl.toggleDrawer()
    expect(ctrl.isOpen).toBe(true)
    ctrl.toggleDrawer()
    expect(ctrl.isOpen).toBe(false)
  })

  it('renders playlist items', () => {
    const pm = new mod.PlaylistManager()
    pm.localTracks = [
      { title: 'Track 1', artist: 'A1', url: '/1.flac' },
      { title: 'Track 2', artist: 'A2', url: '/2.flac' }
    ]
    const bridge = new mod.AudioBridge()
    const ctrl = new mod.DrawerController({
      playlist: pm,
      bridge: bridge,
      config: { source: 'local', volume: 0.1, autoplayHome: false, order: 'list', neteaseId: '' }
    })
    ctrl._renderPlaylist()

    const items = document.querySelectorAll('#music-playlist li')
    expect(items.length).toBe(2)
    expect(items[0].textContent).toContain('Track 1')
    expect(items[1].textContent).toContain('Track 2')
  })

  it('loadTrack updates current track info', () => {
    const pm = new mod.PlaylistManager()
    pm.localTracks = [
      { title: 'My Song', artist: 'My Artist', url: '/song.flac', cover: '/cover.jpg' }
    ]
    const bridge = new mod.AudioBridge()
    // jsdom doesn't support canPlayType, stub it to allow FLAC
    bridge.canPlayType = () => true
    bridge.audio.load = () => {} // stub not-implemented
    const ctrl = new mod.DrawerController({
      playlist: pm,
      bridge: bridge,
      config: { source: 'local', volume: 0.1, autoplayHome: false, order: 'list', neteaseId: '' }
    })
    ctrl._renderPlaylist()
    ctrl.loadTrack(0)

    expect(document.getElementById('music-current-title').textContent).toBe('My Song')
    expect(document.getElementById('music-current-artist').textContent).toBe('My Artist')
  })

  it('persists and restores state from localStorage', () => {
    const pm = new mod.PlaylistManager()
    pm.localTracks = [{ title: 'T', artist: 'A', url: '/t.flac' }]
    const bridge = new mod.AudioBridge()
    // jsdom doesn't support canPlayType, stub it to allow FLAC
    bridge.canPlayType = () => true
    bridge.audio.load = () => {} // stub not-implemented
    const ctrl = new mod.DrawerController({
      playlist: pm,
      bridge: bridge,
      config: { source: 'local', volume: 0.1, autoplayHome: false, order: 'list', neteaseId: '' }
    })
    ctrl.loadTrack(0)

    // Check localStorage was written
    const saved = JSON.parse(localStorage.getItem('music_player_state'))
    expect(saved).not.toBeNull()
    expect(saved.index).toBe(0)
    expect(typeof saved.volume).toBe('number')
  })

  it('updates play icon state correctly', () => {
    const pm = new mod.PlaylistManager()
    const bridge = new mod.AudioBridge()
    const ctrl = new mod.DrawerController({ playlist: pm, bridge: bridge })

    ctrl._setState(mod.State.PLAYING)
    const icon = document.querySelector('#music-play i')
    expect(icon.className).toBe('fas fa-pause')

    ctrl._setState(mod.State.PAUSED)
    expect(icon.className).toBe('fas fa-play')
  })

  it('toggles order between list and random', () => {
    const pm = new mod.PlaylistManager()
    const bridge = new mod.AudioBridge()
    const ctrl = new mod.DrawerController({ playlist: pm, bridge: bridge })

    expect(ctrl.order).toBe('list')
    document.getElementById('music-order').click()
    expect(ctrl.order).toBe('random')
    document.getElementById('music-order').click()
    expect(ctrl.order).toBe('list')
  })

  it('shows loading status when state is LOADING', () => {
    const pm = new mod.PlaylistManager()
    const bridge = new mod.AudioBridge()
    const ctrl = new mod.DrawerController({ playlist: pm, bridge: bridge })

    ctrl._setState(mod.State.LOADING)
    expect(ctrl.els.statusLoading.style.display).toBe('')
    expect(ctrl.els.statusError.style.display).toBe('none')
  })

  it('shows error status when state is ERROR', () => {
    const pm = new mod.PlaylistManager()
    const bridge = new mod.AudioBridge()
    const ctrl = new mod.DrawerController({ playlist: pm, bridge: bridge })

    ctrl._setState(mod.State.ERROR)
    expect(ctrl.els.statusError.style.display).toBe('')
    expect(ctrl.els.statusLoading.style.display).toBe('none')
  })
})

/* ============================
   createDOM & injectRightsideButton
   ============================ */
describe('createDOM', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('creates drawer and mask when they do not exist', () => {
    // Only set up the rightside container, no drawer
    document.body.innerHTML = `
      <div id="rightside">
        <div id="rightside-config-show">
          <button id="go-up" type="button"><i class="fas fa-arrow-up"></i></button>
        </div>
      </div>
    `
    const { createDOM } = loadModule()
    createDOM()

    expect(document.getElementById('music-drawer')).toBeTruthy()
    expect(document.getElementById('music-drawer-mask')).toBeTruthy()
    expect(document.getElementById('music-play')).toBeTruthy()
    expect(document.getElementById('music-playlist')).toBeTruthy()
  })

  it('does not duplicate DOM if called twice', () => {
    document.body.innerHTML = `
      <div id="rightside">
        <div id="rightside-config-show">
          <button id="go-up" type="button"><i class="fas fa-arrow-up"></i></button>
        </div>
      </div>
    `
    const { createDOM } = loadModule()
    createDOM()
    createDOM()

    expect(document.querySelectorAll('#music-drawer').length).toBe(1)
    expect(document.querySelectorAll('#music-drawer-mask').length).toBe(1)
  })

  it('injects music button before #go-up in rightside', () => {
    document.body.innerHTML = `
      <div id="rightside">
        <div id="rightside-config-show">
          <button id="rightside-config" type="button"></button>
          <button id="go-up" type="button"></button>
        </div>
      </div>
    `
    const { injectRightsideButton } = loadModule()
    injectRightsideButton()

    const btn = document.getElementById('music-player-btn')
    expect(btn).toBeTruthy()
    // Button should be right before #go-up
    expect(btn.nextElementSibling.id).toBe('go-up')
  })

  it('does not inject button if rightside-config-show is absent', () => {
    document.body.innerHTML = '<div></div>'
    const { injectRightsideButton } = loadModule()
    injectRightsideButton()

    expect(document.getElementById('music-player-btn')).toBeNull()
  })
})
