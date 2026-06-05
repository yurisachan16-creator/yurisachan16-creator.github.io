import { afterEach, beforeEach, describe, expect, it } from 'vitest'

function loadModule () {
  const modulePath = require.resolve('../../source/js/reading-memory.js')
  delete require.cache[modulePath]
  return require(modulePath)
}

function installMemoryLocalStorage () {
  const store = new Map()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem (key) {
        return store.has(key) ? store.get(key) : null
      },
      setItem (key, value) {
        store.set(key, String(value))
      },
      removeItem (key) {
        store.delete(key)
      },
      clear () {
        store.clear()
      }
    }
  })
}

function setupDOM () {
  installMemoryLocalStorage()
  document.head.innerHTML = ''
  document.body.innerHTML = `
    <div id="rightside-config-show"><button id="go-up" type="button"></button></div>
  `
}

describe('reading-memory', () => {
  beforeEach(() => {
    setupDOM()
  })

  afterEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    delete window.__readingMemory
  })

  it('records reading history with newest entry first and de-duplicates by URL', () => {
    const memory = loadModule()

    expect(memory.recordHistory({ title: '第一篇', url: '/posts/a/', progress: 12 })).toBe(true)
    expect(memory.recordHistory({ title: '第二篇', url: '/posts/b/', progress: 44 })).toBe(true)
    expect(memory.recordHistory({ title: '第一篇更新', url: '/posts/a/', progress: 70 })).toBe(true)

    const state = memory.readState()
    expect(state.history.map((entry) => entry.title)).toEqual(['第一篇更新', '第二篇'])
    expect(state.history[0].progress).toBe(70)
  })

  it('toggles saved posts and normalizes URLs', () => {
    const memory = loadModule()

    expect(memory.toggleSaved({ title: '稍后读', url: 'posts/a/index.html' })).toBe(true)
    expect(memory.hasSaved('/posts/a/')).toBe(true)
    expect(memory.toggleSaved({ title: '稍后读', url: '/posts/a/' })).toBe(false)
    expect(memory.hasSaved('/posts/a/')).toBe(false)
  })

  it('injects the rightside reading memory button once', () => {
    loadModule()
    loadModule()

    expect(document.querySelectorAll('#reading-memory-btn')).toHaveLength(1)
    expect(document.getElementById('reading-memory-btn').getAttribute('aria-label')).toBe('打开稍后读和阅读历史')
    expect(document.getElementById('reading-memory-btn').getAttribute('aria-controls')).toBe('reading-memory-drawer')
    expect(document.getElementById('reading-memory-btn').getAttribute('aria-expanded')).toBe('false')
  })

  it('updates drawer expanded state and closes with Escape', () => {
    const memory = loadModule()
    const button = document.getElementById('reading-memory-btn')
    const drawer = document.getElementById('reading-memory-drawer')

    memory.openDrawer('saved')

    expect(drawer.hidden).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('true')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(drawer.hidden).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })
})
