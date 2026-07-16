import { expect, test, type Page } from '@playwright/test'

const VISUAL_MANIFEST = '**/assets/launch/manifest.json'
const VISUAL_RUNTIME = '**/assets/launch/assets/visual-runtime.js'

const deterministicVisualRuntime = String.raw`
const TEST_CONFIG = Object.freeze({ seed: 240713, quality: 'high' })

export async function mountLaunchExperience(options) {
  const host = options.host
  const scene = host.querySelector('.yurisa-launch__scene')
  const primary = host.querySelector('[data-action="primary"]')
  const primaryLabel = primary.querySelector('[data-launch-button-label]')
  const skip = host.querySelector('[data-action="skip"]')
  const mute = host.querySelector('[data-action="mute"]')
  const whiteout = host.querySelector('.yurisa-launch__whiteout')
  let disposed = false
  let clockMs = 0
  let motionStage = 'idle'

  host.dataset.testSeed = String(TEST_CONFIG.seed)
  host.dataset.testQuality = TEST_CONFIG.quality
  // Shell regression deliberately uses a neutral field. It must never become
  // a second, hand-drawn visual truth beside the production WebGL/reference
  // suite in genshin-launch-scene-visual.spec.ts.
  const style = document.createElement('style')
  style.dataset.visualAdapter = 'true'
  style.textContent = '.yurisa-launch__scene{background:#245d89}'
  host.append(style)

  function setDocumentPhase(phase) {
    host.dataset.phase = phase
    document.documentElement.dataset.launchState = phase
  }
  function setLabel(value) {
    if (primaryLabel) primaryLabel.textContent = value
    else primary.textContent = value
  }
  function showControls() {
    skip.hidden = false
    mute.hidden = false
    mute.disabled = false
    mute.setAttribute('aria-label', '静音')
    mute.setAttribute('aria-pressed', 'false')
    primary.hidden = false
    primary.disabled = false
  }

  setDocumentPhase('loading')
  host.dataset.visualPhase = 'loading'
  options.onProgress({ stage: 'models', value: .42, label: '正在连接天空长廊' })

  const controls = {
    config: TEST_CONFIG,
    get clockMs() { return clockMs },
    ready() {
      if (disposed) return
      clockMs = 0
      motionStage = 'ready'
      host.dataset.visualPhase = 'ready'
      setDocumentPhase('ready')
      setLabel('启动 / Press Start')
      showControls()
      options.onProgress({ stage: 'first-frame', value: 1, label: '天空长廊已就绪' })
      options.onFirstFrame()
    },
    gateForming() {
      if (disposed) return
      clockMs = 0
      motionStage = 'gate-forming'
      host.dataset.visualPhase = 'gate-forming'
      setDocumentPhase('travelling')
      primary.hidden = true
    },
    gateReady() {
      if (disposed) return
      clockMs = 1458.334
      motionStage = 'gate-ready'
      host.dataset.visualPhase = 'gate-ready'
      setDocumentPhase('gate-ready')
      setLabel('点击进入博客')
      showControls()
    },
    gateStable() {
      if (disposed) return
      clockMs = 5000
      motionStage = 'gate-ready'
      host.dataset.visualPhase = 'gate-ready'
      setDocumentPhase('gate-ready')
    },
    enterWhite() {
      if (disposed) return
      clockMs = 500
      motionStage = 'enter-white'
      host.dataset.visualPhase = 'whiteout'
      setDocumentPhase('entering')
      whiteout.classList.add('is-active')
    },
    async revealHero() {
      if (disposed) return
      controls.enterWhite()
      clockMs = 2100
      motionStage = 'enter-complete'
      await Promise.resolve()
      await options.onRequestFinalize('entered')
    }
  }
  window.__visualLaunch = controls

  function dispose() {
    if (disposed) return
    disposed = true
    style.remove()
  }
  options.signal?.addEventListener('abort', dispose, { once: true })

  return {
    pause() {},
    resize() {},
    dispose,
    getDebugState() {
      return { generation: options.generation, phase: host.dataset.phase, motionStage, quality: TEST_CONFIG.quality, clockMs, seed: TEST_CONFIG.seed, disposed }
    }
  }
}
`

const viewports = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 }
] as const

async function installVisualHarness (page: Page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net|challenges\.cloudflare\.com|cubism\.live2d\.com|unpkg\.com)\/.*/, route => route.abort())
  await page.route('https://api.i-meto.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route(VISUAL_MANIFEST, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      version: 'visual-v1',
      entry: '/assets/launch/assets/visual-runtime.js',
      dracoDecoderPath: '/assets/launch/assets/draco-r185/',
      requiredAssetIds: [],
      assets: {}
    })
  }))
  await page.route(VISUAL_RUNTIME, route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: deterministicVisualRuntime
  }))
  await page.addInitScript(() => {
    localStorage.setItem('site_style_v1', 'pixel')
    try {
      Object.defineProperty(window, 'WebGL2RenderingContext', {
        configurable: true,
        value: function VisualWebGL2RenderingContext () {}
      })
    } catch (_) {}
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2') return { getExtension: () => null } as unknown as RenderingContext
      return original.apply(this, [type, ...args] as Parameters<typeof original>)
    } as typeof HTMLCanvasElement.prototype.getContext
  })
}

async function stabilizeVisuals (page: Page) {
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation: none !important;
      caret-color: transparent !important;
      scroll-behavior: auto !important;
      transition: none !important;
    }
    #waifu, #waifu-toggle, #live2d-assistant-btn { display: none !important; }
    .typed-cursor { visibility: hidden !important; }
  ` })
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready
  })
  await page.waitForTimeout(100)
}

async function prepareHero (page: Page) {
  await page.evaluate(async () => {
    const visual = (window as typeof window & {
      __visualLaunch: { revealHero(): Promise<void> }
    }).__visualLaunch
    await visual.revealHero()
  })
  await expect(page.locator('.yurisa-launch')).toHaveCount(0)
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    const subtitle = document.querySelector('#subtitle')
    if (subtitle) {
      const stable = subtitle.cloneNode(false) as HTMLElement
      stable.textContent = 'Press Start to Continue ▶'
      subtitle.replaceWith(stable)
    }
    document.querySelectorAll('.typed-cursor').forEach(element => element.remove())
  })
  await page.waitForTimeout(150)
}

// This fast adapter validates the production launch shell, CTA states and
// Hero hand-off. The DOM whiteout class is only a lifecycle marker: the real
// BloomTransition and white field belong to the production WebGL regression
// in genshin-launch-scene-visual.spec.ts.
test.describe('Genshin launch shell and hand-off visual regression', () => {
  for (const viewport of viewports) {
    test(`${viewport.label} loading, ready, gate and Hero`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'One canonical Chromium baseline is maintained')
      test.setTimeout(30_000)
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await installVisualHarness(page)
      await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean((window as typeof window & { __visualLaunch?: unknown }).__visualLaunch))
      await stabilizeVisuals(page)

      const screenshotOptions = {
        animations: 'disabled' as const,
        caret: 'hide' as const,
        fullPage: false,
        maxDiffPixelRatio: 0.003,
        scale: 'css' as const,
        threshold: 0.2
      }
      const host = page.locator('.yurisa-launch')
      await expect(host).toHaveAttribute('data-visual-phase', 'loading')
      const skip = host.locator('[data-action="skip"]')
      const tools = host.locator('.yurisa-launch__tools')
      await expect(skip).toBeVisible({ timeout: 3_500 })
      await expect(tools).toHaveCSS('opacity', '1')
      const loadingContract = await host.evaluate(element => {
        const host = element as HTMLElement
        const loader = host.querySelector<HTMLElement>('.yurisa-launch__loader')
        const logo = host.querySelector<HTMLElement>('.yurisa-launch__brand-logo')
        const progress = host.querySelector<HTMLElement>('[data-launch-progress]')
        const tools = host.querySelector<HTMLElement>('.yurisa-launch__tools')
        const controls = tools
          ? Array.from(tools.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
          : []
        if (!loader || !logo || !progress || !tools) throw new Error('loading shell contract is incomplete')
        return {
          loader: { width: loader.offsetWidth, height: loader.offsetHeight },
          logo: { width: logo.offsetWidth, height: logo.offsetHeight },
          progressHeight: progress.offsetHeight,
          tools: { width: tools.offsetWidth, height: tools.offsetHeight },
          controls: controls.map(control => ({ width: control.offsetWidth, height: control.offsetHeight })),
          fontFamily: getComputedStyle(host).fontFamily,
          fontLoaded: document.fonts?.check('12px "Noto Sans SC"') ?? false
        }
      })
      expect(loadingContract.loader).toEqual({ width: 420, height: 230 })
      expect(loadingContract.logo).toEqual({ width: 56, height: 56 })
      expect(loadingContract.progressHeight).toBe(2)
      expect(loadingContract.tools).toEqual({ width: 52, height: 148 })
      expect(loadingContract.controls).toEqual([
        { width: 44, height: 44 },
        { width: 44, height: 44 },
        { width: 44, height: 44 }
      ])
      expect(loadingContract.fontLoaded).toBe(true)
      expect(loadingContract.fontFamily.split(',')[0].replace(/["']/g, '').trim()).toBe('Noto Sans SC')
      await expect.soft(page).toHaveScreenshot(`launch-loading-${viewport.label}.png`, screenshotOptions)

      await page.evaluate(() => (window as typeof window & { __visualLaunch: { ready(): void } }).__visualLaunch.ready())
      await expect(host).toHaveAttribute('data-visual-phase', 'ready')
      const readyContract = await host.evaluate(element => {
        const primary = element.querySelector<HTMLElement>('[data-action="primary"]')
        const surface = primary?.querySelector<HTMLElement>('[data-launch-primary-surface]')
        const icon = surface?.querySelector<HTMLElement>('i')
        if (!primary || !surface || !icon) throw new Error('ready control contract is incomplete')
        return {
          primary: { width: primary.offsetWidth, height: primary.offsetHeight },
          surface: { width: surface.offsetWidth, height: surface.offsetHeight },
          icon: { width: icon.offsetWidth, height: icon.offsetHeight }
        }
      })
      expect(readyContract).toEqual({
        primary: { width: 64, height: 64 },
        surface: { width: 64, height: 64 },
        icon: { width: 20, height: 20 }
      })
      await expect.soft(page).toHaveScreenshot(`launch-ready-${viewport.label}.png`, screenshotOptions)

      await page.evaluate(() => {
        const visual = (window as typeof window & {
          __visualLaunch: { gateForming(): void, gateReady(): void, gateStable(): void }
        }).__visualLaunch
        visual.gateForming()
        visual.gateReady()
        visual.gateStable()
      })
      await expect(host).toHaveAttribute('data-visual-phase', 'gate-ready')
      const gateClock = await page.evaluate(() => (window as typeof window & {
        __visualLaunch: { clockMs: number }
      }).__visualLaunch.clockMs)
      expect(gateClock).toBe(5_000)
      const gateContract = await host.evaluate(element => {
        const host = element as HTMLElement
        const primary = host.querySelector<HTMLElement>('[data-action="primary"]')
        const surface = primary?.querySelector<HTMLElement>('[data-launch-primary-surface]')
        if (!primary || !surface) throw new Error('gate control contract is incomplete')
        return {
          hitRegionRatio: primary.offsetWidth / host.clientWidth,
          hitRegionHeight: primary.offsetHeight,
          surface: { width: surface.offsetWidth, height: surface.offsetHeight },
          surfaceRadius: parseFloat(getComputedStyle(surface).borderRadius),
          label: primary.querySelector<HTMLElement>('[data-launch-button-label]')?.textContent
        }
      })
      expect(gateContract.hitRegionRatio).toBeCloseTo(0.96, 2)
      expect(gateContract.hitRegionHeight).toBeGreaterThanOrEqual(52)
      expect(gateContract.surface).toEqual({ width: 320, height: 52 })
      expect(gateContract.surfaceRadius).toBeGreaterThanOrEqual(26)
      expect(gateContract.label).toBe('点击进入博客')
      await expect.soft(page).toHaveScreenshot(`launch-gate-ready-${viewport.label}.png`, screenshotOptions)

      await prepareHero(page)
      const enterClock = await page.evaluate(() => (window as typeof window & {
        __visualLaunch: { clockMs: number }
      }).__visualLaunch.clockMs)
      expect(enterClock).toBe(2_100)
      await expect(page.locator('#site-title')).toBeVisible()
      await expect.soft(page).toHaveScreenshot(`launch-hero-${viewport.label}.png`, screenshotOptions)
    })
  }
})
