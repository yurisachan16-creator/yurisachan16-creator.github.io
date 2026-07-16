import { expect, test, type Page } from '@playwright/test'

const MANIFEST_PATH = '**/assets/launch/manifest.json'
const TEST_RUNTIME_PATH = '**/assets/launch/assets/e2e-runtime.js'
const HOST_SELECTOR = 'body > .yurisa-launch'

const testManifest = {
  version: 'e2e-v1',
  entry: '/assets/launch/assets/e2e-runtime.js',
  dracoDecoderPath: '/assets/launch/assets/draco-r185/',
  requiredAssetIds: [],
  assets: {}
}

/**
 * A deterministic scene adapter used to exercise the production bootstrap,
 * focus/inert lifecycle and full two-step journey without depending on a CI
 * worker's GPU. Runtime rendering itself remains covered by unit/build gates.
 */
const testRuntimeModule = String.raw`
const stats = window.__e2eLaunch = window.__e2eLaunch || {
  mounts: 0,
  disposes: 0,
  active: 0,
  generations: [],
  phases: [],
  requestedOutcomes: [],
  motionMilestones: [],
  gateReadyAt: 0,
  enterCompleteAt: 0
}

export async function mountLaunchExperience(options) {
  const host = options.host
  const primary = host.querySelector('[data-action="primary"]')
  const label = primary && primary.querySelector('[data-launch-button-label]')
  const status = host.querySelector('[data-launch-status]')
  const scene = host.querySelector('.yurisa-launch__scene')
  const canvas = document.createElement('canvas')
  canvas.className = 'yurisa-launch__canvas'
  canvas.setAttribute('aria-hidden', 'true')
  scene.append(canvas)

  let phase = 'loading'
  let motionStage = 'idle'
  let travelElapsedMs = 0
  let enterElapsedMs = 0
  let disposed = false
  const timers = new Set()
  const handledMilestones = new Set()
  stats.mounts += 1
  stats.active += 1
  stats.generations.push(options.generation)

  function schedule(callback, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (!disposed) callback()
    }, delay)
    timers.add(timer)
    return timer
  }

  function setPhase(next) {
    phase = next
    host.dataset.phase = next
    document.documentElement.dataset.launchState = next
    stats.phases.push({ generation: options.generation, phase: next })
  }

  function setLabel(value) {
    if (label) label.textContent = value
    else if (primary) primary.textContent = value
  }

  function requestFinalize(outcome) {
    if (disposed) return
    stats.requestedOutcomes.push(outcome)
    options.onRequestFinalize(outcome)
  }

  function emitMotionMilestone(milestone) {
    if (disposed || handledMilestones.has(milestone)) return
    if (milestone === 'gate-forming') {
      if (phase !== 'travelling') return
      motionStage = milestone
    } else if (milestone === 'gate-ready') {
      if (phase !== 'travelling' || motionStage !== 'gate-forming') return
      motionStage = milestone
      stats.gateReadyAt = travelElapsedMs
      setPhase('gate-ready')
      setLabel('点击进入博客')
      primary.disabled = false
      primary.hidden = false
      primary.focus({ preventScroll: true })
    } else if (milestone === 'enter-white') {
      if (phase !== 'entering') return
      motionStage = milestone
      host.querySelector('.yurisa-launch__whiteout')?.classList.add('is-active')
    } else if (milestone === 'enter-complete') {
      if (phase !== 'entering') return
      motionStage = milestone
      stats.enterCompleteAt = enterElapsedMs
      requestFinalize('entered')
    }
    host.dataset.motionStage = milestone
    handledMilestones.add(milestone)
    stats.motionMilestones.push({ generation: options.generation, milestone, travelElapsedMs, enterElapsedMs })
  }

  window.__e2eLaunchControl = {
    generation: options.generation,
    advanceTravelTo(elapsedMs) {
      if (elapsedMs < travelElapsedMs) throw new Error('travel clock cannot run backwards')
      travelElapsedMs = elapsedMs
      if (elapsedMs >= 0) emitMotionMilestone('gate-forming')
      if (elapsedMs >= 1458.334) emitMotionMilestone('gate-ready')
    },
    advanceEnterTo(elapsedMs) {
      if (elapsedMs < enterElapsedMs) throw new Error('enter clock cannot run backwards')
      enterElapsedMs = elapsedMs
      if (elapsedMs >= 500) emitMotionMilestone('enter-white')
      if (elapsedMs >= 2100) emitMotionMilestone('enter-complete')
    }
  }

  function onPrimary() {
    if (phase === 'ready') {
      setPhase('travelling')
      motionStage = 'armed'
      primary.hidden = true
      return
    }
    if (phase === 'gate-ready') {
      setPhase('entering')
      motionStage = 'entering'
      enterElapsedMs = 0
      primary.hidden = true
    }
  }

  function onContextLost(event) {
    event.preventDefault()
    requestFinalize('fallback')
  }

  primary.addEventListener('click', onPrimary)
  canvas.addEventListener('webglcontextlost', onContextLost)
  options.signal?.addEventListener('abort', () => dispose(), { once: true })
  setPhase('loading')
  options.onProgress({ stage: 'scene', value: 0.25, label: '正在加载场景' })

  schedule(() => {
    options.onProgress({ stage: 'first-frame', value: 1, label: '场景已就绪' })
    options.onFirstFrame()
    setPhase('ready')
    if (status) status.textContent = '天空长廊已就绪'
    setLabel('启动 / Press Start')
    primary.disabled = false
    primary.hidden = false
    primary.focus({ preventScroll: true })
  }, 250)

  function dispose() {
    if (disposed) return
    disposed = true
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    primary.removeEventListener('click', onPrimary)
    canvas.removeEventListener('webglcontextlost', onContextLost)
    canvas.remove()
    stats.disposes += 1
    stats.active -= 1
  }

  return {
    pause() {},
    resize() {},
    dispose,
    getDebugState() {
      return { generation: options.generation, phase, motionStage, travelElapsedMs, enterElapsedMs, disposed }
    }
  }
}
`

async function blockUnrelatedThirdParty (page: Page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net|challenges\.cloudflare\.com|cubism\.live2d\.com)\/.*/, route => route.abort())
  await page.route('https://api.i-meto.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]'
  }))
}

async function installLaunchObservers (page: Page) {
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __launchCompletions?: Array<{ generation: number, outcome: string }>
      __launchHostsObserved?: number
      __launchSkipShownDelays?: number[]
      __latestLaunchHostAddedAt?: number
      __launchWhiteoutPresentations?: Array<{ active: boolean, display: string, opacity: string }>
    }
    target.__launchCompletions = []
    target.__launchHostsObserved = 0
    target.__launchSkipShownDelays = []
    target.__launchWhiteoutPresentations = []
    new MutationObserver(records => {
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          record.attributeName === 'hidden' &&
          record.target instanceof HTMLElement &&
          record.target.matches('[data-action="skip"]') &&
          !record.target.hidden &&
          typeof target.__latestLaunchHostAddedAt === 'number'
        ) {
          target.__launchSkipShownDelays?.push(performance.now() - target.__latestLaunchHostAddedAt)
        }
        if (
          record.type === 'attributes' &&
          record.attributeName === 'class' &&
          record.target instanceof HTMLElement &&
          record.target.matches('.yurisa-launch__whiteout')
        ) {
          const style = getComputedStyle(record.target)
          target.__launchWhiteoutPresentations?.push({
            active: record.target.classList.contains('is-active'),
            display: style.display,
            opacity: style.opacity
          })
        }
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.matches('.yurisa-launch')) {
            target.__launchHostsObserved = (target.__launchHostsObserved || 0) + 1
            target.__latestLaunchHostAddedAt = performance.now()
          }
        }
      }
    }).observe(document, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true, subtree: true })
    document.addEventListener('yurisa:launch-complete', event => {
      const detail = (event as CustomEvent).detail
      target.__launchCompletions?.push({
        generation: detail.generation,
        outcome: detail.outcome
      })
    })
  })
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

async function installDeterministicWebGL2Gate (page: Page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'WebGL2RenderingContext', {
        configurable: true,
        value: function E2EWebGL2RenderingContext () {}
      })
    } catch (_) {}

    const originalGetContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      if (type === 'webgl2') {
        return {
          getExtension: () => null
        } as unknown as RenderingContext
      }
      return originalGetContext.apply(this, [type, ...args] as Parameters<typeof originalGetContext>)
    } as typeof HTMLCanvasElement.prototype.getContext
  })
}

async function mockDeterministicRuntime (page: Page) {
  await page.route(MANIFEST_PATH, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(testManifest)
  }))
  await page.route(TEST_RUNTIME_PATH, route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: testRuntimeModule
  }))
}

async function preparePreview (page: Page) {
  await blockUnrelatedThirdParty(page)
  await isolateLive2DForLaunch(page)
  await installLaunchObservers(page)
  await installDeterministicWebGL2Gate(page)
  await mockDeterministicRuntime(page)
  await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })
  const state = await page.evaluate(() => {
    const coordinator = (window as typeof window & {
      __genshinLaunch: {
        getState(): { active: boolean, source?: string }
      }
    }).__genshinLaunch
    return coordinator.getState()
  })
  expect(state).toMatchObject({ active: true, source: 'auto' })
}

async function expectPageUnlocked (page: Page) {
  await expect(page.locator(HOST_SELECTOR)).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveClass(/yurisa-launch-active/)
  await expect(page.locator('body')).not.toHaveClass(/yurisa-launch-active/)
  await expect(page.locator('#body-wrap')).not.toHaveAttribute('inert', '')
  await expect(page.locator('#site-title')).toBeVisible()
}

async function waitForCompletionCount (page: Page, expected: number) {
  await expect.poll(() => page.evaluate(() => (window as typeof window & {
    __launchCompletions?: Array<unknown>
  }).__launchCompletions?.length || 0)).toBe(expected)
}

test.describe('Genshin launch integration', () => {
  test('default-off does not mount or request any 3D launch resource', async ({ page }) => {
    await blockUnrelatedThirdParty(page)
    const launchRequests: string[] = []
    page.on('request', request => {
      if (request.url().includes('/assets/launch/')) launchRequests.push(request.url())
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)

    await expect(page.locator('meta[name="yurisa-launch-enabled"]')).toHaveAttribute('content', 'false')
    await expect(page.locator(HOST_SELECTOR)).toHaveCount(0)
    await expect(page.locator('#site-title')).toBeVisible()
    expect(launchRequests).toEqual([])
  })

  test('reduced-motion bypasses preview before requesting the manifest', async ({ page }) => {
    await blockUnrelatedThirdParty(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const launchRequests: string[] = []
    page.on('request', request => {
      if (request.url().includes('/assets/launch/')) launchRequests.push(request.url())
    })

    await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)

    await expect(page.locator(HOST_SELECTOR)).toHaveCount(0)
    await expect(page.locator('#site-title')).toBeVisible()
    expect(launchRequests).toEqual([])
  })

  test('preview follows scene milestones through gate entry and the 2.1s hero handoff', async ({ page }, testInfo) => {
    test.setTimeout(45_000)
    if (testInfo.project.name === 'mobile-chrome') {
      await page.setViewportSize({ width: 390, height: 844 })
    }
    await preparePreview(page)

    const host = page.locator(HOST_SELECTOR)
    await expect(host).toBeVisible()
    await expect(host).toHaveAttribute('data-phase', 'ready', { timeout: 5_000 })
    await expect(page.locator('#body-wrap')).toHaveAttribute('inert', '')
    await expect(page.locator('#rightside')).toHaveAttribute('inert', '')
    const initialPhases = await page.evaluate(() => {
      const stats = (window as typeof window & {
        __e2eLaunch: { phases: Array<{ generation: number, phase: string }> }
      }).__e2eLaunch
      return stats.phases
        .filter(entry => entry.generation === 1)
        .map(entry => entry.phase)
    })
    expect(initialPhases).toEqual(['loading', 'ready'])

    const primary = page.locator('[data-action="primary"]')
    await expect(primary).toBeVisible()
    await expect(primary).toContainText('启动')
    await expect(host.locator('[data-action="skip"]')).toBeVisible({ timeout: 3_500 })
    await expect(host.locator('.yurisa-launch__tools')).toHaveCSS('opacity', '1')
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready
    })
    const readyLayout = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.yurisa-launch')
      const button = host?.querySelector<HTMLButtonElement>('[data-action="primary"]')
      const canvas = host?.querySelector<HTMLCanvasElement>('.yurisa-launch__canvas')
      const surface = button?.querySelector<HTMLElement>('[data-launch-primary-surface]')
      const primaryIcon = surface?.querySelector<HTMLElement>('i')
      const tools = host?.querySelector<HTMLElement>('.yurisa-launch__tools')
      const toolControls = tools
        ? Array.from(tools.children).filter((element): element is HTMLElement => element instanceof HTMLElement)
        : []
      if (!host || !button || !canvas || !surface || !primaryIcon || !tools) {
        throw new Error('launch ready layout is unavailable')
      }
      ;(window as typeof window & { __launchPrimaryNode?: HTMLButtonElement }).__launchPrimaryNode = button
      ;(window as typeof window & { __launchPrimaryIcon?: HTMLElement }).__launchPrimaryIcon = primaryIcon
      const hostRect = host.getBoundingClientRect()
      const toolsRect = tools.getBoundingClientRect()
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        portrait: window.innerHeight > window.innerWidth,
        stage: { width: host.clientWidth, height: host.clientHeight },
        canvas: { width: canvas.clientWidth, height: canvas.clientHeight },
        hostRect: { width: hostRect.width, height: hostRect.height },
        transform: getComputedStyle(host).transform,
        button: {
          width: button.offsetWidth,
          height: button.offsetHeight,
          rightGap: host.clientWidth - button.offsetLeft - button.offsetWidth,
          bottomGap: host.clientHeight - button.offsetTop - button.offsetHeight
        },
        surface: { width: surface.offsetWidth, height: surface.offsetHeight },
        icon: { width: primaryIcon.offsetWidth, height: primaryIcon.offsetHeight },
        tools: {
          width: tools.offsetWidth,
          height: tools.offsetHeight,
          screenWidth: toolsRect.width,
          screenHeight: toolsRect.height,
          order: toolControls.map(element =>
            element.dataset.action || (element.hasAttribute('data-launch-credits') ? 'credits' : '')
          ),
          controls: toolControls.map(element => ({
            width: element.offsetWidth,
            height: element.offsetHeight,
            iconHidden: element.querySelector('i')?.getAttribute('aria-hidden')
          }))
        },
        fontFamily: getComputedStyle(host).fontFamily,
        fontLoaded: document.fonts?.check('12px "Noto Sans SC"') ?? false
      }
    })
    expect(Math.abs(readyLayout.button.width - readyLayout.button.height)).toBeLessThanOrEqual(1)
    expect(readyLayout.button.width).toBeCloseTo(64, 0)
    expect(readyLayout.surface).toEqual({ width: 64, height: 64 })
    expect(readyLayout.icon).toEqual({ width: 20, height: 20 })
    expect(readyLayout.button.rightGap).toBeGreaterThanOrEqual(20)
    expect(readyLayout.button.bottomGap).toBeGreaterThanOrEqual(20)
    expect(readyLayout.tools.width).toBe(52)
    expect(readyLayout.tools.height).toBe(148)
    expect(readyLayout.tools.order).toEqual(['skip', 'mute', 'credits'])
    expect(readyLayout.tools.controls).toEqual([
      { width: 44, height: 44, iconHidden: 'true' },
      { width: 44, height: 44, iconHidden: 'true' },
      { width: 44, height: 44, iconHidden: 'true' }
    ])
    expect(readyLayout.fontLoaded).toBe(true)
    expect(readyLayout.fontFamily.split(',')[0].replace(/["']/g, '').trim()).toBe('Noto Sans SC')
    expect(readyLayout.hostRect.width).toBeCloseTo(readyLayout.viewport.width, 0)
    expect(readyLayout.hostRect.height).toBeCloseTo(readyLayout.viewport.height, 0)
    if (readyLayout.portrait) {
      expect(readyLayout.stage.width).toBeCloseTo(readyLayout.viewport.height, 0)
      expect(readyLayout.stage.height).toBeCloseTo(readyLayout.viewport.width, 0)
      expect(readyLayout.canvas.width).toBeCloseTo(readyLayout.viewport.height, 0)
      expect(readyLayout.canvas.height).toBeCloseTo(readyLayout.viewport.width, 0)
      expect(readyLayout.transform).not.toBe('none')
      expect(readyLayout.tools.screenWidth).toBeCloseTo(148, 0)
      expect(readyLayout.tools.screenHeight).toBeCloseTo(52, 0)
    } else {
      expect(readyLayout.stage.width).toBeCloseTo(readyLayout.viewport.width, 0)
      expect(readyLayout.stage.height).toBeCloseTo(readyLayout.viewport.height, 0)
      expect(readyLayout.canvas.width).toBeCloseTo(readyLayout.viewport.width, 0)
      expect(readyLayout.canvas.height).toBeCloseTo(readyLayout.viewport.height, 0)
      expect(readyLayout.transform).toBe('none')
      expect(readyLayout.tools.screenWidth).toBeCloseTo(52, 0)
      expect(readyLayout.tools.screenHeight).toBeCloseTo(148, 0)
    }
    await primary.click()
    await expect(host).toHaveAttribute('data-phase', 'travelling')

    await page.evaluate(() => (window as typeof window & {
      __e2eLaunchControl: { advanceTravelTo(elapsedMs: number): void }
    }).__e2eLaunchControl.advanceTravelTo(0))
    await expect(host).toHaveAttribute('data-motion-stage', 'gate-forming')
    await expect(host).toHaveAttribute('data-phase', 'travelling')
    await page.evaluate(() => (window as typeof window & {
      __e2eLaunchControl: { advanceTravelTo(elapsedMs: number): void }
    }).__e2eLaunchControl.advanceTravelTo(1_458.334))
    await expect(host).toHaveAttribute('data-phase', 'gate-ready')
    await expect(host).toHaveAttribute('data-motion-stage', 'gate-ready')

    const travelState = await page.evaluate(() => {
      const stats = (window as typeof window & {
        __e2eLaunch: {
          gateReadyAt: number
          motionMilestones: Array<{ milestone: string }>
        }
      }).__e2eLaunch
      return {
        gateReadyAt: stats.gateReadyAt,
        milestones: stats.motionMilestones.map(item => item.milestone)
      }
    })
    expect(travelState.gateReadyAt).toBeCloseTo(1_458.334, 3)
    expect(travelState.milestones).toEqual(['gate-forming', 'gate-ready'])

    await expect(primary).toContainText('点击进入博客')
    const gateLayout = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.yurisa-launch')
      const button = host?.querySelector<HTMLButtonElement>('[data-action="primary"]')
      const surface = button?.querySelector<HTMLElement>('[data-launch-primary-surface]')
      const primaryIcon = surface?.querySelector<HTMLElement>('i')
      if (!host || !button || !surface || !primaryIcon) throw new Error('launch gate layout is unavailable')
      return {
        widthRatio: button.offsetWidth / host.clientWidth,
        height: button.offsetHeight,
        surfaceWidth: surface.offsetWidth,
        surfaceHeight: surface.offsetHeight,
        surfaceBorderRadius: parseFloat(getComputedStyle(surface).borderRadius),
        samePrimary: (window as typeof window & { __launchPrimaryNode?: HTMLButtonElement }).__launchPrimaryNode === button,
        sameIcon: (window as typeof window & { __launchPrimaryIcon?: HTMLElement }).__launchPrimaryIcon === primaryIcon,
        focused: document.activeElement === button
      }
    })
    expect(gateLayout.widthRatio).toBeCloseTo(0.96, 2)
    expect(gateLayout.height).toBeGreaterThanOrEqual(52)
    expect(gateLayout.surfaceWidth).toBe(320)
    expect(gateLayout.surfaceHeight).toBe(52)
    expect(gateLayout.surfaceBorderRadius).toBeGreaterThanOrEqual(26)
    expect(gateLayout.samePrimary).toBe(true)
    expect(gateLayout.sameIcon).toBe(true)
    expect(gateLayout.focused).toBe(true)
    await primary.click()
    await expect(host).toHaveAttribute('data-phase', 'entering')
    const tools = host.locator('.yurisa-launch__tools')
    await expect(tools).toHaveCSS('visibility', 'hidden')
    await expect(tools).toHaveCSS('opacity', '0')
    await expect(tools).toHaveCSS('pointer-events', 'none')
    await page.evaluate(() => (window as typeof window & {
      __e2eLaunchControl: { advanceEnterTo(elapsedMs: number): void }
    }).__e2eLaunchControl.advanceEnterTo(499))
    await expect(host).toHaveAttribute('data-phase', 'entering')
    await expect(host).not.toHaveAttribute('data-motion-stage', 'enter-white')
    await page.evaluate(() => (window as typeof window & {
      __e2eLaunchControl: { advanceEnterTo(elapsedMs: number): void }
    }).__e2eLaunchControl.advanceEnterTo(500))
    await expect(host).toHaveAttribute('data-motion-stage', 'enter-white')
    await page.evaluate(() => (window as typeof window & {
      __e2eLaunchControl: { advanceEnterTo(elapsedMs: number): void }
    }).__e2eLaunchControl.advanceEnterTo(2_099))
    await expect(host).toHaveAttribute('data-phase', 'entering')
    await page.evaluate(() => (window as typeof window & {
      __e2eLaunchControl: { advanceEnterTo(elapsedMs: number): void }
    }).__e2eLaunchControl.advanceEnterTo(2_100))
    await expectPageUnlocked(page)
    await waitForCompletionCount(page, 1)

    const whiteoutPresentations = await page.evaluate(() => (window as typeof window & {
      __launchWhiteoutPresentations: Array<{ active: boolean, display: string, opacity: string }>
    }).__launchWhiteoutPresentations)
    expect(whiteoutPresentations).toContainEqual({ active: true, display: 'none', opacity: '0' })

    const completedMotion = await page.evaluate(() => {
      const stats = (window as typeof window & {
        __e2eLaunch: {
          enterCompleteAt: number
          motionMilestones: Array<{ milestone: string }>
        }
      }).__e2eLaunch
      return {
        enterCompleteAt: stats.enterCompleteAt,
        milestones: stats.motionMilestones.map(item => item.milestone)
      }
    })
    expect(completedMotion.enterCompleteAt).toBe(2_100)
    expect(completedMotion.milestones).toEqual([
      'gate-forming',
      'gate-ready',
      'enter-white',
      'enter-complete'
    ])

    const completions = await page.evaluate(() => (window as typeof window & {
      __launchCompletions: Array<{ generation: number, outcome: string }>
    }).__launchCompletions)
    expect(completions).toHaveLength(1)
    expect(completions[0].outcome).toBe('entered')
    await expect(page.locator('#site-title')).toBeFocused()
  })

  test('Escape works immediately and the complete utility dock appears only after two seconds', async ({ page }) => {
    await preparePreview(page)
    const host = page.locator(HOST_SELECTOR)
    await expect(host).toBeVisible()

    await page.keyboard.press('Escape')
    await expectPageUnlocked(page)

    await expect(page.locator('#genshin-launch-replay-btn')).toBeEnabled()
    await page.locator('#genshin-launch-replay-btn').dispatchEvent('click')
    await expect(host).toBeVisible()
    const skip = page.locator('[data-action="skip"]')
    const tools = host.locator('.yurisa-launch__tools')
    const credits = tools.locator('[data-launch-credits]')
    await expect(skip).toBeHidden()
    const hiddenDock = await tools.evaluate(element => {
      const target = element as HTMLElement
      const style = getComputedStyle(target)
      const credits = target.querySelector<HTMLElement>('[data-launch-credits]')
      credits?.focus()
      return {
        width: target.offsetWidth,
        height: target.offsetHeight,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        creditsFocused: document.activeElement === credits
      }
    })
    expect(hiddenDock).toEqual({
      width: 52,
      height: 148,
      opacity: '0',
      pointerEvents: 'none',
      creditsFocused: false
    })
    await expect(skip).toBeVisible({ timeout: 3_500 })
    await expect(tools).toHaveCSS('opacity', '1')
    await expect(tools).toHaveCSS('pointer-events', 'auto')
    await expect(tools).toBeVisible()
    expect(await tools.evaluate(element => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight
    }))).toEqual({ width: 52, height: 148 })
    expect(await credits.evaluate(element => {
      ;(element as HTMLElement).focus()
      return document.activeElement === element
    })).toBe(true)
    const skipDelay = await page.evaluate(() => {
      const delays = (window as typeof window & {
        __launchSkipShownDelays?: number[]
      }).__launchSkipShownDelays || []
      return delays[delays.length - 1] || 0
    })
    expect(skipDelay).toBeGreaterThanOrEqual(1_900)
    await skip.click()
    await expectPageUnlocked(page)
    await waitForCompletionCount(page, 2)

    const outcomes = await page.evaluate(() => (window as typeof window & {
      __launchCompletions: Array<{ outcome: string }>
    }).__launchCompletions.map(item => item.outcome))
    expect(outcomes).toEqual(['skipped', 'skipped'])
  })

  test('Escape and Skip restore a usable Hero within the 150ms p95 budget', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'One stable desktop Chromium timing profile is maintained')
    test.setTimeout(45_000)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await preparePreview(page)

    const samples: Record<'escape' | 'skip', number[]> = {
      escape: [],
      skip: []
    }
    const actions = [
      ...Array.from({ length: 20 }, () => 'escape' as const),
      ...Array.from({ length: 20 }, () => 'skip' as const)
    ]

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index]
      await expect(page.locator(HOST_SELECTOR)).toHaveAttribute('data-phase', 'ready', { timeout: 5_000 })
      const result = await page.evaluate((requestedAction) => new Promise<{
        elapsedMs: number
        usable: boolean
        focused: boolean
        nextFrameResponsive: boolean
        scrollResponsive: boolean
      }>(resolve => {
        const startedAt = performance.now()
        const unlockObserver = new MutationObserver(() => {
          if (document.querySelector('.yurisa-launch')) return
          unlockObserver.disconnect()
          requestAnimationFrame(() => {
            setTimeout(() => {
              const hero = document.querySelector<HTMLElement>('#site-title')
              const bodyWrap = document.querySelector<HTMLElement>('#body-wrap')
              const heroStyle = hero ? getComputedStyle(hero) : null
              const usable = Boolean(
                !document.querySelector('.yurisa-launch') &&
                !document.documentElement.classList.contains('yurisa-launch-active') &&
                !document.body.classList.contains('yurisa-launch-active') &&
                getComputedStyle(document.documentElement).overflow !== 'hidden' &&
                getComputedStyle(document.body).overflow !== 'hidden' &&
                bodyWrap && !bodyWrap.hasAttribute('inert') &&
                hero && heroStyle && heroStyle.display !== 'none' &&
                heroStyle.visibility !== 'hidden' && hero.getClientRects().length > 0
              )
              const maximumScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight)
              const previousScrollBehavior = document.documentElement.style.scrollBehavior
              document.documentElement.style.scrollBehavior = 'auto'
              window.scrollTo(0, Math.min(1, maximumScroll))
              const scrollResponsive = maximumScroll === 0 || window.scrollY > 0
              window.scrollTo(0, 0)
              document.documentElement.style.scrollBehavior = previousScrollBehavior
              resolve({
                elapsedMs: performance.now() - startedAt,
                usable,
                focused: document.activeElement === hero ||
                  (document.activeElement as HTMLElement | null)?.id === 'genshin-launch-replay-btn',
                nextFrameResponsive: true,
                scrollResponsive
              })
            }, 0)
          })
        })
        unlockObserver.observe(document.body, { childList: true })

        if (requestedAction === 'escape') {
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true
          }))
          return
        }
        const skip = document.querySelector<HTMLButtonElement>('[data-action="skip"]')
        if (!skip) throw new Error('Skip control is unavailable')
        // Its separate two-second visibility contract is covered above. This
        // timing sample starts at the user action once the control is usable.
        skip.hidden = false
        skip.click()
      }), action)

      expect(result.usable, `${action} sample ${index + 1} restored the Hero`).toBe(true)
      expect(result.focused, `${action} sample ${index + 1} restored focus`).toBe(true)
      expect(result.nextFrameResponsive, `${action} sample ${index + 1} reached the next frame`).toBe(true)
      expect(result.scrollResponsive, `${action} sample ${index + 1} restored scrolling`).toBe(true)
      samples[action].push(result.elapsedMs)

      if (index < actions.length - 1) {
        await expect(page.locator('#genshin-launch-replay-btn')).toBeEnabled()
        await page.locator('#genshin-launch-replay-btn').dispatchEvent('click')
      }
    }
    await expect(page.locator('#genshin-launch-replay-btn')).toBeEnabled()
    await waitForCompletionCount(page, actions.length)

    const p95 = (values: number[]) => {
      const sorted = [...values].sort((left, right) => left - right)
      return sorted[Math.ceil(sorted.length * 0.95) - 1]
    }
    const metrics = {
      escape: { samplesMs: samples.escape, p95Ms: p95(samples.escape) },
      skip: { samplesMs: samples.skip, p95Ms: p95(samples.skip) }
    }
    await testInfo.attach('launch-skip-escape-timing.json', {
      body: Buffer.from(`${JSON.stringify(metrics, null, 2)}\n`),
      contentType: 'application/json'
    })
    expect(metrics.escape.p95Ms, `Escape samples: ${JSON.stringify(samples.escape)}`).toBeLessThanOrEqual(150)
    expect(metrics.skip.p95Ms, `Skip samples: ${JSON.stringify(samples.skip)}`).toBeLessThanOrEqual(150)
  })

  test('replay creates a new generation and cleans every generation exactly once', async ({ page }) => {
    await preparePreview(page)
    const host = page.locator(HOST_SELECTOR)
    await expect(host).toHaveAttribute('data-phase', 'ready', { timeout: 5_000 })
    const firstGeneration = Number(await host.getAttribute('data-generation'))

    await page.keyboard.press('Escape')
    await expectPageUnlocked(page)
    await waitForCompletionCount(page, 1)
    await expect(page.locator('#genshin-launch-replay-btn')).toBeEnabled()
    await page.locator('#genshin-launch-replay-btn').dispatchEvent('click')
    await expect(host).toHaveAttribute('data-phase', 'ready', { timeout: 5_000 })
    const secondGeneration = Number(await host.getAttribute('data-generation'))
    expect(secondGeneration).toBeGreaterThan(firstGeneration)
    await expect(page.locator(HOST_SELECTOR)).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expectPageUnlocked(page)
    await waitForCompletionCount(page, 2)

    const lifecycle = await page.evaluate(() => {
      const target = window as typeof window & {
        __e2eLaunch: {
          mounts: number
          disposes: number
          active: number
          generations: number[]
        }
        __launchCompletions: Array<{ generation: number, outcome: string }>
      }
      return {
        stats: target.__e2eLaunch,
        completions: target.__launchCompletions,
        canvases: document.querySelectorAll('body > .yurisa-launch canvas').length
      }
    })
    expect(lifecycle.stats.mounts).toBe(2)
    expect(lifecycle.stats.disposes).toBe(2)
    expect(lifecycle.stats.active).toBe(0)
    expect(lifecycle.stats.generations).toEqual([firstGeneration, secondGeneration])
    expect(lifecycle.completions.map(item => item.generation)).toEqual([firstGeneration, secondGeneration])
    expect(lifecycle.completions.map(item => item.outcome)).toEqual(['skipped', 'skipped'])
    expect(lifecycle.canvases).toBe(0)
  })

  test('a WebGL context loss fails open and disables replay for the page', async ({ page }) => {
    await preparePreview(page)
    const host = page.locator(HOST_SELECTOR)
    await expect(host).toHaveAttribute('data-phase', 'ready', { timeout: 5_000 })

    await page.locator('.yurisa-launch__canvas').dispatchEvent('webglcontextlost')
    await expectPageUnlocked(page)
    await waitForCompletionCount(page, 1)
    await expect(page.locator('#genshin-launch-replay-btn')).toBeDisabled()
    await expect(page.locator('[data-launch-announcer]')).toContainText('已为你打开博客')

    const outcomes = await page.evaluate(() => (window as typeof window & {
      __launchCompletions: Array<{ outcome: string }>
    }).__launchCompletions.map(item => item.outcome))
    expect(outcomes).toEqual(['fallback'])
  })

  test('a manifest failure removes the shell and restores the existing homepage', async ({ page }) => {
    await blockUnrelatedThirdParty(page)
    await isolateLive2DForLaunch(page)
    await installLaunchObservers(page)
    await installDeterministicWebGL2Gate(page)
    await page.route(MANIFEST_PATH, async route => {
      // Keep the failed request pending long enough for every browser's
      // MutationObserver to record both mount and fail-open teardown.
      await new Promise(resolve => setTimeout(resolve, 1_000))
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' })
    })

    await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => page.evaluate(() => (window as typeof window & {
      __launchHostsObserved?: number
    }).__launchHostsObserved || 0)).toBeGreaterThan(0)
    await expectPageUnlocked(page)
    await waitForCompletionCount(page, 1)
    await expect(page.locator('#genshin-launch-replay-btn')).toBeDisabled()

    const outcomes = await page.evaluate(() => (window as typeof window & {
      __launchCompletions: Array<{ outcome: string }>
    }).__launchCompletions.map(item => item.outcome))
    expect(outcomes).toEqual(['fallback'])
  })
})
