import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const MANIFEST_ROUTE = '**/assets/launch/manifest.json'
const RELEASE_RUNTIME_ROUTE = '**/assets/launch/assets/release-runtime.js'

const cleanupRuntimeModule = String.raw`
const stats = window.__launchReleaseStats = window.__launchReleaseStats || {
  mounts: 0,
  disposes: 0,
  active: 0,
  activeRaf: 0,
  listeners: 0,
  audioNodes: 0,
  generations: []
}

export async function mountLaunchExperience(options) {
  const host = options.host
  const scene = host.querySelector('.yurisa-launch__scene')
  const primary = host.querySelector('[data-action="primary"]')
  const canvas = document.createElement('canvas')
  canvas.className = 'yurisa-launch__canvas'
  canvas.setAttribute('aria-hidden', 'true')
  scene.append(canvas)

  let disposed = false
  let raf = 0
  let audioStarted = false
  stats.mounts += 1
  stats.active += 1
  stats.activeRaf += 1
  stats.listeners += 2
  stats.generations.push(options.generation)

  function frame() {
    if (!disposed) raf = requestAnimationFrame(frame)
  }
  function onResize() {}
  function onPrimary() {
    if (audioStarted) return
    audioStarted = true
    stats.audioNodes += 1
  }
  function dispose() {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', onResize)
    primary.removeEventListener('click', onPrimary)
    canvas.remove()
    if (audioStarted) stats.audioNodes -= 1
    stats.disposes += 1
    stats.active -= 1
    stats.activeRaf -= 1
    stats.listeners -= 2
  }

  window.addEventListener('resize', onResize)
  primary.addEventListener('click', onPrimary)
  raf = requestAnimationFrame(frame)
  options.signal?.addEventListener('abort', dispose, { once: true })
  host.dataset.phase = 'ready'
  document.documentElement.dataset.launchState = 'ready'
  primary.hidden = false
  primary.disabled = false
  options.onProgress({ stage: 'first-frame', value: 1, label: '场景已就绪' })
  options.onFirstFrame()

  return {
    pause() {},
    resize() {},
    dispose,
    getDebugState() {
      return { generation: options.generation, phase: 'ready', disposed }
    }
  }
}
`

async function installWebGL2EligibilityStub (page: Page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'WebGL2RenderingContext', {
        configurable: true,
        value: function ReleaseGateWebGL2RenderingContext () {}
      })
    } catch (_) {}
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2') return { getExtension: () => null } as unknown as RenderingContext
      return original.apply(this, [type, ...args] as Parameters<typeof original>)
    } as typeof HTMLCanvasElement.prototype.getContext
  })
}

async function blockThirdParty (page: Page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net|challenges\.cloudflare\.com|cubism\.live2d\.com|unpkg\.com)\/.*/, route => route.abort())
  await page.route('https://api.i-meto.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]'
  }))
}

async function isolateLive2DForLaunch (page: Page) {
  await page.route('**/js/live2d-assistant.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: `window.__live2dAssistant = {
      suspendForLaunch: function () { return true },
      resumeFromLaunch: function () { return Promise.resolve(true) }
    }`
  }))
}

async function installSlow4GProfile (context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: 400 * 1024 / 8,
    uploadThroughput: 128 * 1024 / 8,
    connectionType: 'cellular4g'
  })
}

test.describe('Genshin launch release gates', () => {
  test('Slow 4G keeps the shell usable and exposes the complete utility dock after two seconds', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'CDP network shaping runs once on desktop Chromium')
    test.setTimeout(20_000)

    await blockThirdParty(page)
    await isolateLive2DForLaunch(page)
    await installWebGL2EligibilityStub(page)
    await page.addInitScript(() => {
      const target = window as typeof window & {
        __launchReleaseTiming?: { hostAt?: number, skipAt?: number }
      }
      target.__launchReleaseTiming = {}
      const start = () => {
        const observer = new MutationObserver(() => {
          const host = document.querySelector('.yurisa-launch')
          const skip = document.querySelector<HTMLButtonElement>('[data-action="skip"]')
          if (host && target.__launchReleaseTiming?.hostAt === undefined) {
            target.__launchReleaseTiming.hostAt = performance.now()
          }
          if (skip && !skip.hidden && target.__launchReleaseTiming?.skipAt === undefined) {
            target.__launchReleaseTiming.skipAt = performance.now()
          }
        })
        observer.observe(document.documentElement, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ['hidden']
        })
      }
      if (document.documentElement) start()
      else document.addEventListener('DOMContentLoaded', start, { once: true })
    })
    await page.route(MANIFEST_ROUTE, async route => {
      // Keep the request pending well beyond the two-second Skip contract.
      // A 2.4s failure left only a ~400ms observation window before fallback
      // removed the host, which Playwright's polling could legitimately miss.
      await new Promise(resolve => setTimeout(resolve, 5_000))
      await route.fulfill({
        status: 503,
        contentType: 'text/plain',
        body: 'release-gate-slow-response'
      }).catch(() => {})
    })
    await installSlow4GProfile(context, page)

    await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })
    const host = page.locator('.yurisa-launch')
    const skip = page.locator('[data-action="skip"]')
    const tools = host.locator('.yurisa-launch__tools')
    await expect(host).toBeVisible({ timeout: 4_000 })
    await expect(skip).toBeHidden()
    expect(await tools.evaluate(element => {
      const target = element as HTMLElement
      const credits = target.querySelector<HTMLElement>('[data-launch-credits]')
      credits?.focus()
      return {
        width: target.offsetWidth,
        height: target.offsetHeight,
        opacity: getComputedStyle(target).opacity,
        pointerEvents: getComputedStyle(target).pointerEvents,
        creditsFocused: document.activeElement === credits
      }
    })).toEqual({
      width: 52,
      height: 148,
      opacity: '0',
      pointerEvents: 'none',
      creditsFocused: false
    })
    await expect(skip).toBeVisible({ timeout: 3_200 })
    await expect(tools).toHaveCSS('opacity', '1')
    await expect(tools).toHaveCSS('pointer-events', 'auto')
    await expect(tools).toBeVisible()
    expect(await tools.evaluate(element => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight
    }))).toEqual({ width: 52, height: 148 })

    const timing = await page.evaluate(() => (window as typeof window & {
      __launchReleaseTiming: { hostAt: number, skipAt: number }
    }).__launchReleaseTiming)
    expect(timing.skipAt - timing.hostAt).toBeGreaterThanOrEqual(1_800)
    expect(timing.skipAt - timing.hostAt).toBeLessThan(3_000)

    await skip.click()
    await expect(host).toHaveCount(0)
    await expect(page.locator('#body-wrap')).not.toHaveAttribute('inert', '')
    await expect(page.locator('#site-title')).toBeVisible()
    await page.waitForTimeout(1_600)
  })

  test('five replay generations return canvas, RAF, listeners and audio to baseline', async ({ page }) => {
    test.setTimeout(20_000)
    await blockThirdParty(page)
    await isolateLive2DForLaunch(page)
    await installWebGL2EligibilityStub(page)
    await page.addInitScript(() => {
      const target = window as typeof window & {
        __launchReleaseCompletions?: Array<{ generation: number, outcome: string }>
      }
      target.__launchReleaseCompletions = []
      document.addEventListener('yurisa:launch-complete', event => {
        target.__launchReleaseCompletions?.push((event as CustomEvent).detail)
      })
    })
    await page.route(MANIFEST_ROUTE, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 'release-e2e-v1',
        entry: '/assets/launch/assets/release-runtime.js',
        dracoDecoderPath: '/assets/launch/assets/draco-r185/',
        requiredAssetIds: [],
        assets: {}
      })
    }))
    await page.route(RELEASE_RUNTIME_ROUTE, route => route.fulfill({
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      body: cleanupRuntimeModule
    }))

    await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })
    const host = page.locator('.yurisa-launch')
    for (let round = 0; round < 5; round += 1) {
      if (round > 0) {
        await expect(page.locator('#genshin-launch-replay-btn')).toBeEnabled()
        await page.locator('#genshin-launch-replay-btn').dispatchEvent('click')
      }
      await expect(host).toHaveAttribute('data-phase', 'ready', { timeout: 5_000 })
      await expect(page.locator('.yurisa-launch')).toHaveCount(1)
      await host.locator('[data-action="primary"]').click()
      await expect.poll(() => page.evaluate(() => (window as typeof window & {
        __launchReleaseStats: { audioNodes: number }
      }).__launchReleaseStats.audioNodes)).toBe(1)
      await page.keyboard.press('Escape')
      await expect(host).toHaveCount(0)
      await expect(page.locator('#body-wrap')).not.toHaveAttribute('inert', '')
      await expect.poll(() => page.evaluate(() => (window as typeof window & {
        __launchReleaseCompletions?: Array<unknown>
      }).__launchReleaseCompletions?.length || 0)).toBe(round + 1)
      expect(await page.evaluate(() => (window as typeof window & {
        __launchReleaseStats: { audioNodes: number }
      }).__launchReleaseStats.audioNodes)).toBe(0)
    }

    const result = await page.evaluate(() => {
      const target = window as typeof window & {
        __launchReleaseStats: {
          mounts: number
          disposes: number
          active: number
          activeRaf: number
          listeners: number
          audioNodes: number
          generations: number[]
        }
        __launchReleaseCompletions: Array<{ generation: number, outcome: string }>
      }
      return {
        stats: target.__launchReleaseStats,
        completions: target.__launchReleaseCompletions,
        hosts: document.querySelectorAll('.yurisa-launch').length,
        canvases: document.querySelectorAll('.yurisa-launch__canvas').length
      }
    })
    expect(result.stats).toMatchObject({
      mounts: 5,
      disposes: 5,
      active: 0,
      activeRaf: 0,
      listeners: 0,
      audioNodes: 0
    })
    expect(new Set(result.stats.generations).size).toBe(5)
    expect(result.completions).toHaveLength(5)
    expect(result.completions.every(item => item.outcome === 'skipped')).toBe(true)
    expect(result.hosts).toBe(0)
    expect(result.canvases).toBe(0)
  })
})
