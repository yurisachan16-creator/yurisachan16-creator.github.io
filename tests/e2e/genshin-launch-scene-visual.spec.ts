import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import sharp from 'sharp'
import {
  compareGateGeometry,
  compareReadyRoadGeometry,
  compareVisuals,
  maxRgbMeanDelta,
  rgbMean,
  whitePixelRatio,
  type ImageRegion,
  type RgbMean
} from '../helpers/launch-visual-metrics'

const SCENE_CONFIG = Object.freeze({
  seed: 240713,
  quality: 'high' as const
})

const FRAME_MS = 16
// Reference labels use presentation time. The pinned TweenManager uniforms
// were sampled by the preceding RAF at these provenance-backed offsets.
// Production retains the author's natural, unshifted elapsed-time formula.
const ENTER_REFERENCE_SAMPLE_MS = Object.freeze({
  500: 488,
  700: 696,
  840: 840
})
// Cross the 1.4583333333333333s mixer boundary by one sub-millisecond epsilon;
// floating-point subtraction at a non-zero gate epoch can otherwise land 2e-16s short.
const DOOR_FORMATION_MS = 1_458.334
const REFERENCE_ROOT = process.env.GENSHIN_REFERENCE_ROOT
  ? path.resolve(process.env.GENSHIN_REFERENCE_ROOT)
  : path.join(process.cwd(), 'tests/reference/genshin-launch/upstream-090cb90')
const READY_REFERENCE = process.env.GENSHIN_READY_REFERENCE
  ? path.resolve(process.env.GENSHIN_READY_REFERENCE)
  : undefined
const PRODUCTION_MANIFEST_ROUTE = '**/assets/launch/manifest.json'
const PRODUCTION_WRAPPER_ENTRY = '/assets/launch/assets/production-audit-wrapper.js'

const viewports = [
  { label: '1280x720', width: 1280, height: 720, canonical: true, mobile: false },
  { label: '1440x900', width: 1440, height: 900, canonical: false, mobile: false },
  { label: '844x390', width: 844, height: 390, canonical: false, mobile: true }
] as const

const referenceFiles = Object.freeze({
  ready: 'ready.png',
  'road-rise-0600': 'road-rise-0600.png',
  'road-settled-2000': 'road-settled-2000.png',
  'door-formed-1458': 'door-formed-1458.png',
  'gate-stable-5000': 'gate-stable-5000.png',
  'enter-0500': 'enter-0500.png',
  'enter-0700': 'enter-0700.png',
  'enter-0840': 'enter-0840.png'
})

// The +0.6s evidence intentionally catches the wrapped road while it is still
// below the stage; perspective geometry is therefore gated only on ready.
const roadGeometryFrames = new Set<ReferenceFrame>(['ready'])
const gateGeometryFrames = new Set<ReferenceFrame>([
  'door-formed-1458',
  'gate-stable-5000'
])

type ReferenceFrame = keyof typeof referenceFiles
type MotionStage =
  | 'idle'
  | 'ready'
  | 'armed'
  | 'travelling'
  | 'gate-forming'
  | 'gate-ready'
  | 'entering'
  | 'enter-white'
  | 'enter-complete'

type SceneDebugState = {
  phase: string
  motionStage?: MotionStage
  cameraZ?: number
  cameraCenterZ?: number
  roadWrapCount?: number
  gateTriggerZ?: number | null
  gateDoorZ?: number | null
  quality: string
  drawCalls: number
  drawCallBudget: {
    limit: number
    overBudget: boolean
    mitigationStage: number
  }
  triangles: number
  doorAnimationClips?: number
  doorFormationTime?: number
  transitionIntensity?: number
  whiteAlpha?: number
  referenceProfile?: string
  activeRaf?: boolean
  rendererMemory: { geometries: number, textures: number }
  gpuMemory: {
    estimatedBytes: number
    budgetBytes: number
    renderPixels: number
    overBudget: boolean
    mitigationStage: number
  }
  capabilities: Record<string, boolean>
  disposed: boolean
}

type MotionMilestone = {
  stage: MotionStage
  timeMs: number
}

type SceneVisualControl = {
  runtimeEntry: string
  tierOneReady: boolean
  doorAnimationClips: number
  nowMs: number
  milestones: MotionMilestone[]
  advanceTo(timeMs: number): Promise<void>
  advanceUntilMotionStage(stage: MotionStage, timeoutMs: number): Promise<MotionMilestone>
  setFullResolution(fullResolution: boolean): Promise<void>
  debug(): SceneDebugState
  dispose(): void
}

type CanonicalMetricReport = {
  frame: ReferenceFrame
  ssim: number
  diffPixelRatio: number
  rgbMeanDeltas: Record<'sky' | 'horizon' | 'road', number>
  rgbMeans: Record<'sky' | 'horizon' | 'road', { actual: RgbMean, reference: RgbMean }>
}

type ReferenceProvenance = {
  sourceCommit: string
  threeRevision: string
  referenceProfile: string
  seed: number
  viewport: { width: number, height: number }
  clock: { gateTriggerElapsedMs: number }
  captures: Array<{
    name: ReferenceFrame
    elapsedMs: number
    file: string
    width: number
    height: number
    sha256: string
    enterElapsedMs?: number
    whitePixelRatio?: number
    transitionUniforms?: {
      intensity: number
      whiteAlpha: number
    }
  }>
}

declare global {
  interface Window {
    __launchSceneVisual?: SceneVisualControl
  }
}

const shellMarkup = `
  <div class="yurisa-launch__shell">
    <div class="yurisa-launch__sky" aria-hidden="true"></div>
    <div class="yurisa-launch__scene" aria-hidden="true"></div>
    <div class="yurisa-launch__whiteout" aria-hidden="true"></div>
    <h1 class="yurisa-launch__title" id="yurisa-launch-title" tabindex="-1">通往天空之门</h1>
    <section class="yurisa-launch__loader" aria-labelledby="yurisa-launch-title">
      <header class="yurisa-launch__brand" aria-hidden="true">
        <img class="yurisa-launch__brand-logo" src="/img/pixel-logo.png" alt="">
        <span>YURISACHAN</span>
      </header>
      <div class="yurisa-launch__status-row">
        <p class="yurisa-launch__status" data-launch-status aria-live="polite">正在连接天空长廊</p>
        <span class="yurisa-launch__progress-value" data-launch-progress-value aria-hidden="true">0%</span>
      </div>
      <div class="yurisa-launch__progress" data-launch-progress role="progressbar" aria-label="启动资源加载进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span class="yurisa-launch__progress-fill"></span>
      </div>
      <p class="yurisa-launch__loader-hint"><span>ESC</span><span>随时跳过</span></p>
    </section>
    <nav class="yurisa-launch__tools" data-visible="false" aria-label="启动辅助工具" aria-hidden="true" inert>
      <button class="yurisa-launch__tool yurisa-launch__skip" type="button" data-action="skip" data-tooltip="跳过" aria-label="跳过启动画面，进入博客" hidden>
        <i class="yurisa-launch__icon yurisa-launch__icon--skip" aria-hidden="true"></i><span class="yurisa-launch__sr-only" data-launch-control-label>跳过</span>
      </button>
      <button class="yurisa-launch__tool" type="button" data-action="mute" data-tooltip="静音" aria-label="静音" aria-pressed="false" disabled>
        <i class="yurisa-launch__icon yurisa-launch__icon--volume" data-launch-control-icon aria-hidden="true"></i><span class="yurisa-launch__sr-only" data-launch-control-label>静音</span>
      </button>
      <a class="yurisa-launch__tool yurisa-launch__credits" data-launch-credits data-tooltip="来源" href="/credits/" target="_blank" rel="noopener" aria-label="查看非官方演示的素材与实现来源">
        <i class="yurisa-launch__icon yurisa-launch__icon--external" aria-hidden="true"></i><span class="yurisa-launch__sr-only" data-launch-control-label>来源</span>
      </a>
    </nav>
    <button class="yurisa-launch__primary" type="button" data-action="primary" aria-label="启动天空长廊" hidden>
      <span class="yurisa-launch__primary-surface" data-launch-primary-surface>
        <i class="yurisa-launch__icon yurisa-launch__icon--play yurisa-launch__primary-icon yurisa-launch__primary-icon--start" aria-hidden="true"></i>
        <span data-launch-button-label>启动 / Press Start</span>
        <i class="yurisa-launch__icon yurisa-launch__icon--arrow yurisa-launch__primary-icon yurisa-launch__primary-icon--enter" aria-hidden="true"></i>
      </span>
    </button>
  </div>
`

const screenshotOptions = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  maxDiffPixelRatio: 0.025,
  scale: 'css' as const,
  threshold: 0.12
}

const referenceRegions: Record<'sky' | 'horizon' | 'road', ImageRegion> = {
  sky: { x: 0, y: 0, width: 1280, height: 240 },
  horizon: { x: 0, y: 240, width: 1280, height: 240 },
  road: { x: 0, y: 480, width: 1280, height: 240 }
}

async function preparePage (
  page: Page,
  viewport: (typeof viewports)[number]
) {
  if (viewport.mobile) {
    await page.addInitScript(() => {
      const originalMatchMedia = window.matchMedia.bind(window)
      window.matchMedia = query => {
        const result = originalMatchMedia(query)
        if (!query.includes('(pointer: coarse)')) return result
        return new Proxy(result, {
          get (target, property) {
            if (property === 'matches') return true
            const value = Reflect.get(target, property, target)
            return typeof value === 'function' ? value.bind(target) : value
          }
        })
      }
    })
  }
  // A route-only document avoids running the blog, bootstrap eligibility,
  // Live2D or cloud background. CSS and runtime URLs are production outputs.
  await page.route('**/__launch-scene-visual.html', route => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/genshin-launch.css"></head><body></body></html>'
  }))
  await page.goto('/__launch-scene-visual.html', { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation: none !important;
      caret-color: transparent !important;
      scroll-behavior: auto !important;
      transition: none !important;
    }
    #loading-box, #waifu, #waifu-toggle, #live2d-assistant-btn { display: none !important; }
    .yurisa-launch__sky,
    .yurisa-launch__whiteout,
    .yurisa-launch__brand,
    .yurisa-launch__title,
    .yurisa-launch__loader,
    .yurisa-launch__primary,
    .yurisa-launch__tools {
      opacity: 0 !important;
    }
  ` })
  await page.evaluate(async ({ markup, seed, quality, frameMs }) => {
    const manifestResponse = await fetch('/assets/launch/manifest.json', {
      cache: 'no-store',
      credentials: 'same-origin'
    })
    if (!manifestResponse.ok) throw new Error(`manifest failed: ${manifestResponse.status}`)
    const manifest = await manifestResponse.json()
    if (!manifest.entry || !manifest.assets?.['model.door']) {
      throw new Error('production launch manifest is incomplete')
    }

    const doorResponse = await fetch(manifest.assets['model.door'].url, { cache: 'force-cache' })
    if (!doorResponse.ok) throw new Error(`door GLB failed: ${doorResponse.status}`)
    const doorBuffer = await doorResponse.arrayBuffer()
    const view = new DataView(doorBuffer)
    if (view.getUint32(0, true) !== 0x46546c67) throw new Error('door asset is not a GLB')
    let offset = 12
    let doorAnimationClips = -1
    while (offset + 8 <= doorBuffer.byteLength) {
      const length = view.getUint32(offset, true)
      const type = view.getUint32(offset + 4, true)
      offset += 8
      if (type === 0x4e4f534a) {
        const json = new TextDecoder()
          .decode(new Uint8Array(doorBuffer, offset, length))
          .replace(/[\u0000\u0020]+$/g, '')
        const gltf = JSON.parse(json)
        doorAnimationClips = Array.isArray(gltf.animations) ? gltf.animations.length : 0
        break
      }
      offset += length
    }

    const host = document.createElement('div')
    host.className = 'yurisa-launch'
    host.dataset.phase = 'loading'
    host.innerHTML = markup
    document.body.append(host)
    document.documentElement.classList.add('yurisa-launch-active')
    document.body.classList.add('yurisa-launch-active')
    document.documentElement.dataset.launchState = 'loading'
    // The isolated visual harness owns explicit resize points. Native observer
    // callbacks would inject extra zero-delta renders between deterministic frames.
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: undefined })

    const sceneHost = host.querySelector<HTMLElement>('.yurisa-launch__scene')
    if (!sceneHost) throw new Error('launch scene host is unavailable')
    const fullWidth = sceneHost.clientWidth
    const fullHeight = sceneHost.clientHeight
    const steppingWidth = Math.min(320, fullWidth)
    const steppingHeight = Math.max(1, Math.round(steppingWidth * fullHeight / fullWidth))

    let now = 0
    let nextId = 1
    const timers = new Map<number, { deadline: number, callback: () => void }>()
    const animationFrames = new Map<number, FrameRequestCallback>()
    const milestones: MotionMilestone[] = []
    let lastMotionStage: MotionStage | undefined
    const clock = {
      now: () => now,
      setTimeout (callback: () => void, delayMs: number) {
        const id = nextId++
        timers.set(id, { deadline: now + Math.max(0, delayMs), callback })
        return id
      },
      clearTimeout (id: number) {
        timers.delete(id)
      },
      requestAnimationFrame (callback: FrameRequestCallback) {
        const id = nextId++
        animationFrames.set(id, callback)
        return id
      },
      cancelAnimationFrame (id: number) {
        animationFrames.delete(id)
      }
    }

    const abortController = new AbortController()
    let handle: { getDebugState(): SceneDebugState, resize(): void, dispose(): void } | undefined
    let tierOneReady = false
    let shouldRenderFrames = true

    const flushDueTimers = async () => {
      for (let pass = 0; pass < 10_000; pass++) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.deadline <= now)
          .sort((left, right) => left[1].deadline - right[1].deadline)
        if (due.length === 0) return
        for (const [id, timer] of due) {
          if (!timers.delete(id)) continue
          timer.callback()
        }
        await Promise.resolve()
      }
      throw new Error(`deterministic timer loop did not settle at ${now}ms`)
    }

    const recordMotionStage = () => {
      if (!handle) return
      const stage = handle.getDebugState().motionStage
      if (!stage || stage === lastMotionStage) return
      lastMotionStage = stage
      milestones.push({ stage, timeMs: now })
    }

    const runFrame = async (timeMs: number) => {
      if (timeMs < now) throw new Error('the deterministic clock cannot run backwards')
      if (timeMs - now > frameMs + 1e-6) {
        throw new Error(`deterministic frame step exceeded ${frameMs}ms: ${now} -> ${timeMs}`)
      }
      now = timeMs
      await flushDueTimers()
      const callbacks = [...animationFrames.values()]
      animationFrames.clear()
      for (const callback of callbacks) callback(now)
      await Promise.resolve()
      await flushDueTimers()
      await Promise.resolve()
      recordMotionStage()
    }

    const advanceTo = async (timeMs: number) => {
      if (timeMs < now) throw new Error('the deterministic clock cannot run backwards')
      while (now + frameMs <= timeMs) await runFrame(now + frameMs)
      if (now < timeMs) await runFrame(timeMs)
    }

    const setFullResolution = async (fullResolution: boolean) => {
      shouldRenderFrames = fullResolution
      if (fullResolution) {
        sceneHost.style.removeProperty('width')
        sceneHost.style.removeProperty('height')
        sceneHost.style.removeProperty('right')
        sceneHost.style.removeProperty('bottom')
      } else {
        sceneHost.style.width = `${steppingWidth}px`
        sceneHost.style.height = `${steppingHeight}px`
        sceneHost.style.right = 'auto'
        sceneHost.style.bottom = 'auto'
      }
      handle?.resize()
      await Promise.resolve()
      recordMotionStage()
    }

    const runtime = await import(manifest.entry)
    handle = await runtime.mountLaunchExperience({
      host,
      generation: 240713,
      manifest,
      signal: abortController.signal,
      onRequestFinalize: () => undefined,
      onFirstFrame: () => undefined,
      onProgress: (progress: { stage: string, value: number }) => {
        if (progress.stage === 'lighting' && progress.value >= 0.94) tierOneReady = true
      },
      // This adapter-only seam is never read from location/search params by
      // production bootstrap. It exists solely for direct deterministic mounts.
      testConfig: {
        seed,
        quality,
        clock,
        shouldRenderFrame: () => shouldRenderFrames
      }
    })
    recordMotionStage()

    window.__launchSceneVisual = {
      runtimeEntry: manifest.entry,
      doorAnimationClips,
      get tierOneReady () { return tierOneReady },
      get nowMs () { return now },
      get milestones () { return milestones.map(milestone => ({ ...milestone })) },
      advanceTo,
      setFullResolution,
      async advanceUntilMotionStage (stage: MotionStage, timeoutMs: number) {
        const deadline = now + timeoutMs
        while (true) {
          const debug = handle?.getDebugState()
          if (debug?.motionStage === stage) {
            return [...milestones].reverse().find(milestone => milestone.stage === stage) || { stage, timeMs: now }
          }
          if (now >= deadline) {
            throw new Error(
              `motion stage ${stage} was not reached by ${deadline}ms; ` +
              `debug=${JSON.stringify(debug)} milestones=${JSON.stringify(milestones)}`
            )
          }
          await runFrame(Math.min(deadline, now + frameMs))
        }
      },
      debug () {
        if (!handle) throw new Error('production launch handle is unavailable')
        return handle.getDebugState()
      },
      dispose () {
        abortController.abort()
        handle?.dispose()
        host.remove()
        document.documentElement.classList.remove('yurisa-launch-active')
        document.body.classList.remove('yurisa-launch-active')
      }
    }
  }, { markup: shellMarkup, ...SCENE_CONFIG, frameMs: FRAME_MS })
}

async function settleBrowserPaint (page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
}

async function advanceTo (page: Page, timeMs: number) {
  await page.evaluate(async target => window.__launchSceneVisual?.advanceTo(target), timeMs)
  await settleBrowserPaint(page)
}

async function advanceForCapture (page: Page, timeMs: number) {
  const now = await currentTime(page)
  const fullResolutionFrom = Math.max(now, timeMs - FRAME_MS)
  if (fullResolutionFrom > now) await advanceTo(page, fullResolutionFrom)
  await page.evaluate(async () => window.__launchSceneVisual?.setFullResolution(true))
  await settleBrowserPaint(page)
  await advanceTo(page, timeMs)
}

async function currentTime (page: Page) {
  return page.evaluate(() => window.__launchSceneVisual?.nowMs ?? 0)
}

async function waitForMotionStage (
  page: Page,
  stage: MotionStage,
  timeoutMs: number
): Promise<MotionMilestone> {
  const milestone = await page.evaluate(
    async ({ expectedStage, maximumMs }) => {
      if (!window.__launchSceneVisual) throw new Error('scene visual control is unavailable')
      return window.__launchSceneVisual.advanceUntilMotionStage(expectedStage, maximumMs)
    },
    { expectedStage: stage, maximumMs: timeoutMs }
  )
  await settleBrowserPaint(page)
  return milestone
}

async function compareCanonicalFrame (
  frame: ReferenceFrame,
  actual: Buffer,
  testInfo: TestInfo
): Promise<CanonicalMetricReport> {
  const expectedPath = frame === 'ready' && READY_REFERENCE
    ? READY_REFERENCE
    : path.join(REFERENCE_ROOT, referenceFiles[frame])
  const expected = await readFile(expectedPath)
  const visual = await compareVisuals(actual, expected, 0.12)
  const rgbMeanDeltas = {} as CanonicalMetricReport['rgbMeanDeltas']
  const rgbMeans = {} as CanonicalMetricReport['rgbMeans']

  for (const [regionName, region] of Object.entries(referenceRegions) as Array<
    [keyof typeof referenceRegions, ImageRegion]
  >) {
    const [actualMean, expectedMean] = await Promise.all([
      rgbMean(actual, region),
      rgbMean(expected, region)
    ])
    rgbMeans[regionName] = { actual: actualMean, reference: expectedMean }
    rgbMeanDeltas[regionName] = maxRgbMeanDelta(actualMean, expectedMean)
  }

  const report = {
    frame,
    ssim: visual.ssim,
    diffPixelRatio: visual.diffPixelRatio,
    rgbMeanDeltas,
    rgbMeans
  }
  const [actualRaw, expectedRaw] = await Promise.all([
    sharp(actual).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }),
    sharp(expected).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  ])
  const diffData = Buffer.alloc(actualRaw.data.length)
  for (let index = 0; index < diffData.length; index++) {
    diffData[index] = Math.min(255, Math.abs(actualRaw.data[index] - expectedRaw.data[index]) * 4)
  }
  const diff = await sharp(diffData, {
    raw: {
      width: actualRaw.info.width,
      height: actualRaw.info.height,
      channels: actualRaw.info.channels
    }
  }).png().toBuffer()
  const actualArtifact = testInfo.outputPath(`canonical-${frame}-actual.png`)
  const referenceArtifact = testInfo.outputPath(`canonical-${frame}-reference.png`)
  const diffArtifact = testInfo.outputPath(`canonical-${frame}-diff-x4.png`)
  await Promise.all([
    writeFile(actualArtifact, actual),
    writeFile(referenceArtifact, expected),
    writeFile(diffArtifact, diff)
  ])
  const reportText = JSON.stringify(report)
  console.info(`[launch-scene-reference] ${reportText}`)
  console.info(`[launch-scene-artifacts] ${JSON.stringify({
    frame,
    actual: actualArtifact,
    reference: referenceArtifact,
    sourceReference: expectedPath,
    diff: diffArtifact
  })}`)
  await Promise.all([
    testInfo.attach(`canonical-${frame}-actual.png`, { path: actualArtifact, contentType: 'image/png' }),
    testInfo.attach(`canonical-${frame}-reference.png`, { path: referenceArtifact, contentType: 'image/png' }),
    testInfo.attach(`canonical-${frame}-diff-x4.png`, { path: diffArtifact, contentType: 'image/png' })
  ])
  await testInfo.attach(`canonical-${frame}-metrics.json`, {
    body: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    contentType: 'application/json'
  })

  if (roadGeometryFrames.has(frame)) {
    const geometry = await compareReadyRoadGeometry(actual, expected)
    const geometryText = JSON.stringify(geometry)
    console.info(`[launch-scene-road-geometry] ${frame} ${geometryText}`)
    await testInfo.attach(`canonical-${frame}-road-geometry.json`, {
      body: Buffer.from(`${JSON.stringify(geometry, null, 2)}\n`),
      contentType: 'application/json'
    })
    expect.soft(
      geometry.passed,
      `${frame} road geometry did not meet the 2% vanishing-point limit: ${geometryText}`
    ).toBe(true)
  }

  if (gateGeometryFrames.has(frame)) {
    const geometry = await compareGateGeometry(actual, expected)
    const geometryText = JSON.stringify(geometry)
    console.info(`[launch-scene-gate-geometry] ${frame} ${geometryText}`)
    await testInfo.attach(`canonical-${frame}-gate-geometry.json`, {
      body: Buffer.from(`${JSON.stringify(geometry, null, 2)}\n`),
      contentType: 'application/json'
    })
    expect.soft(
      geometry.passed,
      `${frame} gate geometry did not meet the 1% center / 5% size limits: ${geometryText}`
    ).toBe(true)
  }

  expect.soft(report.ssim, `${frame} SSIM metrics: ${reportText}`).toBeGreaterThanOrEqual(0.95)
  expect.soft(
    report.diffPixelRatio,
    `${frame} diff metrics at channel threshold 0.12: ${reportText}`
  ).toBeLessThanOrEqual(0.025)
  for (const [region, delta] of Object.entries(report.rgbMeanDeltas)) {
    expect.soft(delta, `${frame}/${region} RGB mean metrics: ${reportText}`).toBeLessThanOrEqual(12)
  }
  return report
}

async function validateReferenceProvenance (testInfo: TestInfo) {
  const provenancePath = path.join(REFERENCE_ROOT, 'provenance.json')
  const provenance = JSON.parse(
    await readFile(provenancePath, 'utf8')
  ) as ReferenceProvenance
  expect(provenance.sourceCommit).toBe('090cb905a53a078fb192fc7e3da2a7a679d35ff4')
  expect(provenance.threeRevision).toBe('150')
  expect(provenance.referenceProfile).toBe('090cb90-r150')
  expect(provenance.seed).toBe(SCENE_CONFIG.seed)
  expect(provenance.viewport).toEqual({ width: 1280, height: 720 })

  const expectedOrder: ReferenceFrame[] = [
    'ready',
    'road-rise-0600',
    'door-formed-1458',
    'road-settled-2000',
    'gate-stable-5000',
    'enter-0500',
    'enter-0700',
    'enter-0840'
  ]
  expect(provenance.captures.map(capture => capture.name)).toEqual(expectedOrder)
  const elapsedByName = Object.fromEntries(
    provenance.captures.map(capture => [capture.name, capture.elapsedMs])
  ) as Record<ReferenceFrame, number>
  const seam = provenance.clock.gateTriggerElapsedMs
  expect(elapsedByName['road-rise-0600'] - seam).toBe(600)
  expect(elapsedByName['door-formed-1458'] - seam).toBe(1_458)
  expect(elapsedByName['road-settled-2000'] - seam).toBe(2_000)
  expect(elapsedByName['gate-stable-5000'] - seam).toBe(5_000)
  expect(elapsedByName['enter-0500'] - elapsedByName['gate-stable-5000']).toBe(500)
  expect(elapsedByName['enter-0700'] - elapsedByName['gate-stable-5000']).toBe(700)
  expect(elapsedByName['enter-0840'] - elapsedByName['gate-stable-5000']).toBe(840)

  for (const capture of provenance.captures) {
    expect(capture.file).toBe(referenceFiles[capture.name])
    expect({ width: capture.width, height: capture.height }).toEqual(provenance.viewport)
    const bytes = await readFile(path.join(REFERENCE_ROOT, capture.file))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(capture.sha256)
    if (capture.name === 'enter-0700' || capture.name === 'enter-0840') {
      expect(capture.whitePixelRatio).toBeGreaterThanOrEqual(0.995)
    }
  }
  const transitionByName = Object.fromEntries(
    provenance.captures.map(capture => [capture.name, capture.transitionUniforms])
  ) as Partial<Record<ReferenceFrame, { intensity: number, whiteAlpha: number }>>
  expect(transitionByName['enter-0500']?.intensity).toBeCloseTo(0.5882241658568204, 12)
  expect(transitionByName['enter-0500']?.whiteAlpha).toBeCloseTo(0, 12)
  expect(transitionByName['enter-0700']?.intensity).toBeCloseTo(1.7065189504373164, 12)
  expect(transitionByName['enter-0700']?.whiteAlpha).toBeCloseTo(0.98, 12)
  expect(transitionByName['enter-0840']?.intensity).toBeCloseTo(3, 12)
  expect(transitionByName['enter-0840']?.whiteAlpha).toBeCloseTo(1, 12)
  await testInfo.attach('upstream-reference-provenance.json', {
    body: Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`),
    contentType: 'application/json'
  })
}

async function captureFrame (
  page: Page,
  canvas: Locator,
  frame: string,
  viewport: (typeof viewports)[number],
  testInfo: TestInfo
): Promise<Buffer> {
  const snapshotName = `launch-scene-${frame}-${viewport.label}.png`
  const captureSize = await canvas.evaluate(element => ({
    cssWidth: element.clientWidth,
    cssHeight: element.clientHeight,
    drawingBufferWidth: element.width,
    drawingBufferHeight: element.height,
    devicePixelRatio: window.devicePixelRatio,
    mobileMedia: window.matchMedia('(max-width: 767px), (pointer: coarse)').matches,
    debug: window.__launchSceneVisual?.debug()
  }))
  expect(captureSize.cssWidth, `${snapshotName} CSS width`).toBe(viewport.width)
  expect(captureSize.cssHeight, `${snapshotName} CSS height`).toBe(viewport.height)
  expect(
    captureSize.mobileMedia,
    `${snapshotName} mobile/coarse media profile`
  ).toBe(viewport.mobile)
  expect(
    captureSize.drawingBufferWidth,
    `${snapshotName} drawing-buffer width: ${JSON.stringify(captureSize)}`
  )
    .toBeGreaterThanOrEqual(Math.floor(viewport.width * 0.5))
  expect(
    captureSize.drawingBufferHeight,
    `${snapshotName} drawing-buffer height: ${JSON.stringify(captureSize)}`
  )
    .toBeGreaterThanOrEqual(Math.floor(viewport.height * 0.5))
  expect(
    captureSize.debug?.gpuMemory.renderPixels,
    `${snapshotName} estimator must use the allocated drawing buffer`
  ).toBe(captureSize.drawingBufferWidth * captureSize.drawingBufferHeight)
  const actual = await canvas.screenshot({
    animations: screenshotOptions.animations,
    caret: screenshotOptions.caret,
    scale: screenshotOptions.scale
  })
  await testInfo.attach(snapshotName, { body: actual, contentType: 'image/png' })

  const expectedPath = testInfo.snapshotPath(snapshotName)
  if (!viewport.canonical) {
    await expect.soft(canvas, `${snapshotName} differs from its checked-in baseline`)
      .toHaveScreenshot(snapshotName, screenshotOptions)
    expect(
      existsSync(expectedPath),
      `Missing visual baseline ${expectedPath}`
    ).toBe(true)
  }

  if (viewport.canonical && frame in referenceFiles) {
    await compareCanonicalFrame(frame as ReferenceFrame, actual, testInfo)
  }
  await page.evaluate(async () => window.__launchSceneVisual?.setFullResolution(false))
  await settleBrowserPaint(page)
  return actual
}

function expectSceneBudgets (
  state: SceneDebugState | undefined,
  viewport: (typeof viewports)[number],
  frame: string
) {
  expect(state, `${viewport.label}/${frame} debug state`).toBeTruthy()
  if (!state) return
  const expectedDrawCalls = viewport.mobile ? 80 : 120
  const expectedGpuBytes = (viewport.mobile ? 96 : 192) * 1024 * 1024
  expect(
    state.drawCallBudget.limit,
    `${viewport.label}/${frame} draw-call profile`
  ).toBe(expectedDrawCalls)
  expect(
    state.drawCalls,
    `${viewport.label}/${frame} draw calls`
  ).toBeLessThanOrEqual(expectedDrawCalls)
  expect(
    state.drawCallBudget.overBudget,
    `${viewport.label}/${frame} draw-call budget: ${JSON.stringify(state.drawCallBudget)}`
  ).toBe(false)
  expect(
    state.gpuMemory.budgetBytes,
    `${viewport.label}/${frame} GPU profile`
  ).toBe(expectedGpuBytes)
  expect(
    state.gpuMemory.estimatedBytes,
    `${viewport.label}/${frame} GPU estimate: ${JSON.stringify(state.gpuMemory)}`
  ).toBeLessThanOrEqual(expectedGpuBytes)
  expect(
    state.gpuMemory.overBudget,
    `${viewport.label}/${frame} GPU budget: ${JSON.stringify(state.gpuMemory)}`
  ).toBe(false)
}

type ProductionAuditRecord = {
  generation: number
  realEntry: string
  abortObserved: boolean
  beforeDispose?: SceneDebugState
  afterDispose?: SceneDebugState
}

type ProductionAudit = {
  completions: Array<{ generation: number, outcome: string }>
  completionTimes: Array<{ generation: number, outcome: string, timeMs: number }>
  records: ProductionAuditRecord[]
  hostAdds: number
  hostRemoves: number
  hostRemovalTimes: Array<{ generation: number, timeMs: number }>
  hostReappearedAfterCompletion: boolean
  escapeStartedAt: number[]
  escapeHandoffs: Array<{
    generation: number
    removedElapsedMs: number
    rafElapsedMs: number
    taskElapsedMs: number
    measuredElapsedMs: number
    elapsedMs: number
    unlocked: boolean
    overflowUnlocked: boolean
    heroVisible: boolean
    scrollResponsive: boolean
  }>
}

async function installProductionAuditHarness (
  page: Page,
  abortAssetId?: string
) {
  const manifest = JSON.parse(
    await readFile(path.join(process.cwd(), 'public/assets/launch/manifest.json'), 'utf8')
  ) as {
    entry: string
    assets: Record<string, { url: string }>
    [key: string]: unknown
  }
  const realEntry = manifest.entry
  if (!/^\/assets\/launch\/assets\/runtime\.[A-Za-z0-9_-]+\.js$/.test(realEntry)) {
    throw new Error(`production manifest did not contain a hashed runtime: ${realEntry}`)
  }

  await page.route(/https:\/\/(cdn\.jsdelivr\.net|challenges\.cloudflare\.com|cubism\.live2d\.com|unpkg\.com)\/.*/, route => route.abort())
  await page.route('https://api.i-meto.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]'
  }))
  await page.route(PRODUCTION_MANIFEST_ROUTE, route => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ ...manifest, entry: PRODUCTION_WRAPPER_ENTRY })
  }))

  const wrapperSource = String.raw`
import { mountLaunchExperience as mountRealLaunchExperience } from ${JSON.stringify(realEntry)};

function snapshot(handle) {
  try { return JSON.parse(JSON.stringify(handle.getDebugState())); } catch (_) { return undefined; }
}

export async function mountLaunchExperience(options) {
  const audit = window.__realProductionLaunchAudit;
  const record = {
    generation: options.generation,
    realEntry: ${JSON.stringify(realEntry)},
    abortObserved: false
  };
  audit.records.push(record);
  let handle;
  options.signal?.addEventListener('abort', () => {
    record.abortObserved = true;
    record.beforeDispose = snapshot(handle);
  }, { once: true });
  handle = await mountRealLaunchExperience({
    ...options,
    testConfig: { seed: ${SCENE_CONFIG.seed}, quality: ${JSON.stringify(SCENE_CONFIG.quality)} }
  });
  const dispose = handle.dispose.bind(handle);
  let disposalRecorded = false;
  handle.dispose = () => {
    if (!record.beforeDispose) record.beforeDispose = snapshot(handle);
    dispose();
    if (!disposalRecorded) {
      disposalRecorded = true;
      record.afterDispose = snapshot(handle);
    }
  };
  return handle;
}
`
  await page.route(`**${PRODUCTION_WRAPPER_ENTRY}`, route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: wrapperSource
  }))

  let abortedRequests = 0
  let abortedUrl: string | undefined
  if (abortAssetId) {
    abortedUrl = manifest.assets[abortAssetId]?.url
    if (!abortedUrl) throw new Error(`unknown production launch asset: ${abortAssetId}`)
    await page.route(`**${abortedUrl}`, route => {
      abortedRequests += 1
      return route.abort('failed')
    })
  }

  await page.addInitScript(() => {
    try { localStorage.setItem('site_style_v1', 'pixel') } catch (_) {}
    const target = window as typeof window & {
      __realProductionLaunchAudit?: ProductionAudit
    }
    const audit: ProductionAudit = {
      completions: [],
      completionTimes: [],
      records: [],
      hostAdds: 0,
      hostRemoves: 0,
      hostRemovalTimes: [],
      hostReappearedAfterCompletion: false,
      escapeStartedAt: [],
      escapeHandoffs: []
    }
    target.__realProductionLaunchAudit = audit
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') audit.escapeStartedAt.push(performance.now())
    }, true)
    document.addEventListener('yurisa:launch-complete', event => {
      const detail = (event as CustomEvent).detail as { generation: number, outcome: string }
      audit.completions.push({ generation: detail.generation, outcome: detail.outcome })
      audit.completionTimes.push({
        generation: detail.generation,
        outcome: detail.outcome,
        timeMs: performance.now()
      })
    })
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.matches('.yurisa-launch')) continue
          if (audit.completions.some(completion => completion.outcome !== 'skipped')) {
            audit.hostReappearedAfterCompletion = true
          }
          audit.hostAdds += 1
        }
        for (const node of record.removedNodes) {
          if (node instanceof HTMLElement && node.matches('.yurisa-launch')) {
            audit.hostRemoves += 1
            audit.hostRemovalTimes.push({
              generation: Number(node.dataset.generation),
              timeMs: performance.now()
            })
            const handoffIndex = audit.hostRemoves - 1
            const startedAt = audit.escapeStartedAt[handoffIndex]
            if (typeof startedAt === 'number') {
              const generation = Number(node.dataset.generation)
              const removedElapsedMs = performance.now() - startedAt
              requestAnimationFrame(() => {
                const rafElapsedMs = performance.now() - startedAt
                setTimeout(() => {
                const taskElapsedMs = performance.now() - startedAt
                const bodyWrap = document.querySelector<HTMLElement>('#body-wrap')
                const hero = document.querySelector<HTMLElement>('#site-title')
                const heroStyle = hero ? getComputedStyle(hero) : null
                const heroRect = hero?.getBoundingClientRect()
                const htmlOverflow = getComputedStyle(document.documentElement).overflow
                const bodyOverflow = getComputedStyle(document.body).overflow
                const maximumScroll = Math.max(
                  0,
                  document.documentElement.scrollHeight - window.innerHeight
                )
                const measuredElapsedMs = performance.now() - startedAt
                const targetScroll = Math.min(32, maximumScroll)
                const previousScrollBehavior = document.documentElement.style.scrollBehavior
                document.documentElement.style.scrollBehavior = 'auto'
                window.scrollTo({ top: targetScroll, behavior: 'auto' })
                const scrollResponsive = Math.abs(window.scrollY - targetScroll) <= 1
                window.scrollTo({ top: 0, behavior: 'auto' })
                document.documentElement.style.scrollBehavior = previousScrollBehavior
                audit.escapeHandoffs.push({
                  generation,
                  removedElapsedMs,
                  rafElapsedMs,
                  taskElapsedMs,
                  measuredElapsedMs,
                  elapsedMs: performance.now() - startedAt,
                  unlocked: !document.documentElement.classList.contains('yurisa-launch-active') &&
                    !document.body.classList.contains('yurisa-launch-active') &&
                    !bodyWrap?.inert && !bodyWrap?.hasAttribute('inert'),
                  overflowUnlocked: htmlOverflow !== 'hidden' && bodyOverflow !== 'hidden',
                  heroVisible: Boolean(
                    hero && heroStyle && heroRect && heroRect.width > 0 && heroRect.height > 0 &&
                    heroStyle.display !== 'none' && heroStyle.visibility !== 'hidden' &&
                    heroStyle.opacity !== '0'
                  ),
                  scrollResponsive
                })
                }, 0)
              })
            }
          }
        }
      }
    }).observe(document, { childList: true, subtree: true })
  })

  return {
    realEntry,
    abortedUrl,
    getAbortedRequests: () => abortedRequests
  }
}

async function waitForProductionReady (page: Page): Promise<SceneDebugState> {
  const host = page.locator('body > .yurisa-launch')
  await expect(host).toHaveAttribute('data-phase', 'ready', { timeout: 45_000 })
  await expect(host.locator('.yurisa-launch__canvas')).toHaveCount(1)
  const debug = await page.evaluate(() => {
    const coordinator = (window as typeof window & {
      __genshinLaunch: { getDebugState(): { runtime?: SceneDebugState } }
    }).__genshinLaunch
    return coordinator.getDebugState().runtime
  })
  expect(debug, 'production coordinator did not expose the real scene debug state').toBeTruthy()
  expect(debug?.roadSegmentCount, 'production scene must preserve all 24 upstream road segments').toBe(24)
  return debug as SceneDebugState
}

async function expectProductionUnlocked (page: Page) {
  await expect(page.locator('body > .yurisa-launch')).toHaveCount(0)
  await expect(page.locator('.yurisa-launch__canvas')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveClass(/yurisa-launch-active/)
  await expect(page.locator('body')).not.toHaveClass(/yurisa-launch-active/)
  await expect(page.locator('#body-wrap')).not.toHaveAttribute('inert', /.*/)
  expect(await page.locator('#body-wrap').evaluate(element => (element as HTMLElement).inert)).toBe(false)
  await expect(page.locator('#site-title')).toBeVisible()
}

async function stabilizeProductionHero (page: Page) {
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation: none !important;
      caret-color: transparent !important;
      scroll-behavior: auto !important;
      transition: none !important;
    }
    #loading-box, #waifu, #waifu-toggle, #live2d-assistant-btn { display: none !important; }
    .typed-cursor { visibility: hidden !important; }
  ` })
  await page.evaluate(async () => {
    window.scrollTo(0, 0)
    if (document.fonts?.ready) await document.fonts.ready
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

test.describe('Genshin production Three.js scene visual regression', () => {
  test.describe.configure({ mode: 'serial' })

  for (const viewport of viewports) {
    test(`${viewport.label} follows the upstream road, gate and enter timeline`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'One canonical Chromium WebGL renderer is maintained')
      test.setTimeout(180_000)
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      if (viewport.canonical) await validateReferenceProvenance(testInfo)

      const shaderErrors: string[] = []
      const consoleMessages: string[] = []
      page.on('console', message => {
        const text = message.text()
        consoleMessages.push(`${message.type()}: ${text}`)
        if (/shader error|validate_status false|program not valid/i.test(text)) shaderErrors.push(text)
      })

      await preparePage(page, viewport)
      const host = page.locator('.yurisa-launch')
      const canvas = page.locator('.yurisa-launch__canvas')
      await page.waitForFunction(
        () => ['ready', 'complete'].includes(
          document.querySelector('.yurisa-launch')?.getAttribute('data-phase') || ''
        ),
        undefined,
        { timeout: 45_000 }
      )
      const mountedPhase = await host.getAttribute('data-phase')
      if (mountedPhase !== 'ready') {
        const debug = await page.evaluate(() => window.__launchSceneVisual?.debug())
        throw new Error(
          `production scene did not reach ready: ${JSON.stringify({ debug, consoleMessages }, null, 2)}`
        )
      }
      await expect(host).toHaveAttribute('data-phase', 'ready', { timeout: 45_000 })
      await page.waitForFunction(
        () => window.__launchSceneVisual?.tierOneReady === true,
        undefined,
        { timeout: 45_000 }
      )
      await expect(canvas).toHaveCount(1)

      const readyState = await page.evaluate(() => ({
        runtimeEntry: window.__launchSceneVisual?.runtimeEntry,
        doorAnimationClips: window.__launchSceneVisual?.doorAnimationClips,
        debug: window.__launchSceneVisual?.debug(),
        doorRequests: performance.getEntriesByType('resource')
          .filter(entry => /\/models\/door\.[a-f0-9]+\.glb$/i.test(new URL(entry.name).pathname))
          .length
      }))
      expect(readyState.runtimeEntry).toMatch(/^\/assets\/launch\/assets\/runtime\.[A-Za-z0-9_-]+\.js$/)
      expect(readyState.doorAnimationClips).toBe(14)
      expect(readyState.doorRequests).toBeGreaterThan(0)
      expect(readyState.debug?.phase).toBe('ready')
      expect(readyState.debug?.motionStage).toBe('ready')
      expect(readyState.debug?.referenceProfile).toBe('090cb90-r150')
      expect(readyState.debug?.disposed).toBe(false)
      expect(readyState.debug?.drawCalls).toBeGreaterThan(5)
      expect(readyState.debug?.triangles).toBeGreaterThan(100)
      expect(readyState.debug?.doorAnimationClips).toBe(14)
      expect(readyState.debug?.rendererMemory.geometries).toBeGreaterThan(2)
      expect(readyState.debug?.rendererMemory.textures).toBeGreaterThan(1)
      expectSceneBudgets(readyState.debug, viewport, 'ready')
      expect(shaderErrors).toEqual([])
      await captureFrame(page, canvas, 'ready', viewport, testInfo)

      const travelStartedAt = await currentTime(page)
      await page.locator('[data-action="primary"]').click()
      await expect(host).toHaveAttribute('data-phase', 'travelling')

      const gateForming = await waitForMotionStage(page, 'gate-forming', 6_000)
      const formingState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(formingState?.motionStage).toBe('gate-forming')
      expect(formingState?.doorFormationTime).toBeGreaterThanOrEqual(0)
      expectSceneBudgets(formingState, viewport, 'gate-forming')
      const gateFormingElapsedMs = gateForming.timeMs - travelStartedAt
      const gateTimingReport = {
        gateFormingElapsedMs,
        cameraZ: formingState?.cameraZ,
        roadWrapCount: formingState?.roadWrapCount,
        milestone: gateForming
      }
      console.info(`[launch-scene-gate-forming] ${JSON.stringify(gateTimingReport)}`)
      await testInfo.attach(`gate-forming-${viewport.label}-metrics.json`, {
        body: Buffer.from(`${JSON.stringify(gateTimingReport, null, 2)}\n`),
        contentType: 'application/json'
      })

      await advanceForCapture(page, gateForming.timeMs + 600)
      const roadRiseState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(roadRiseState?.roadWrapCount).toBeGreaterThan(0)
      expect(roadRiseState?.motionStage).toBe('gate-forming')
      expectSceneBudgets(roadRiseState, viewport, 'road-rise-0600')
      await captureFrame(page, canvas, 'road-rise-0600', viewport, testInfo)

      await advanceForCapture(page, gateForming.timeMs + DOOR_FORMATION_MS)
      const gateReady = await waitForMotionStage(page, 'gate-ready', 0)
      await expect(host).toHaveAttribute('data-phase', 'gate-ready')
      const gateReadyState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(gateReadyState?.motionStage).toBe('gate-ready')
      expect(gateReadyState?.doorFormationTime).toBeCloseTo(DOOR_FORMATION_MS / 1_000, 3)
      expect(gateReady.timeMs - gateForming.timeMs).toBeLessThanOrEqual(DOOR_FORMATION_MS + FRAME_MS)
      expectSceneBudgets(gateReadyState, viewport, 'door-formed-1458')
      await captureFrame(page, canvas, 'door-formed-1458', viewport, testInfo)

      await advanceForCapture(page, gateForming.timeMs + 2_000)
      const roadSettledState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(roadSettledState?.roadWrapCount).toBeGreaterThan(0)
      expect(roadSettledState?.motionStage).toBe('gate-ready')
      expectSceneBudgets(roadSettledState, viewport, 'road-settled-2000')
      await captureFrame(page, canvas, 'road-settled-2000', viewport, testInfo)

      await advanceForCapture(page, gateForming.timeMs + 5_000)
      const stableGateState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(stableGateState?.motionStage).toBe('gate-ready')
      expect(stableGateState?.drawCalls).toBeGreaterThan(5)
      expect(stableGateState?.triangles).toBeGreaterThan(100)
      expect(stableGateState?.doorAnimationClips).toBe(14)
      expectSceneBudgets(stableGateState, viewport, 'gate-stable-5000')
      expect(shaderErrors).toEqual([])
      await captureFrame(page, canvas, 'gate-stable-5000', viewport, testInfo)

      const enterStartedAt = await currentTime(page)
      await page.locator('[data-action="primary"]').click()
      await expect(host).toHaveAttribute('data-phase', 'entering')
      await expect(host.locator('.yurisa-launch__tools')).toHaveCSS('visibility', 'hidden')
      await expect(host.locator('.yurisa-launch__tools')).toHaveCSS('opacity', '0')

      await advanceForCapture(page, enterStartedAt + ENTER_REFERENCE_SAMPLE_MS[500])
      const enterHalfState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(enterHalfState?.motionStage).toBe('entering')
      expect(enterHalfState?.whiteAlpha).toBeCloseTo(0, 5)
      expectSceneBudgets(enterHalfState, viewport, 'enter-0500')
      console.info(`[launch-scene-enter-0500-debug] ${JSON.stringify(enterHalfState)}`)
      await testInfo.attach(`enter-0500-${viewport.label}-debug.json`, {
        body: Buffer.from(`${JSON.stringify(enterHalfState, null, 2)}\n`),
        contentType: 'application/json'
      })
      await captureFrame(page, canvas, 'enter-0500', viewport, testInfo)

      await advanceTo(page, enterStartedAt + 500)
      const enterWhiteMilestoneState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(enterWhiteMilestoneState?.motionStage).toBe('enter-white')

      await advanceForCapture(page, enterStartedAt + ENTER_REFERENCE_SAMPLE_MS[700])
      const enterWhiteState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(enterWhiteState?.motionStage).toBe('enter-white')
      expect(enterWhiteState?.whiteAlpha).toBeCloseTo(0.98, 5)
      expectSceneBudgets(enterWhiteState, viewport, 'enter-0700')
      const enterWhite = await captureFrame(page, canvas, 'enter-0700', viewport, testInfo)
      const enterWhiteRatio = await whitePixelRatio(enterWhite)
      console.info(`[launch-scene-white] ${viewport.label}/enter-0700=${enterWhiteRatio}`)
      expect(
        enterWhiteRatio,
        `${viewport.label} enter +0.7s white pixel ratio was ${(enterWhiteRatio * 100).toFixed(3)}%`
      ).toBeGreaterThanOrEqual(0.995)

      await advanceTo(page, enterStartedAt + 700)
      const enterFullyWhiteState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(enterFullyWhiteState?.whiteAlpha).toBeCloseTo(1, 5)

      await advanceForCapture(page, enterStartedAt + ENTER_REFERENCE_SAMPLE_MS[840])
      const enterCompleteState = await page.evaluate(() => window.__launchSceneVisual?.debug())
      expect(enterCompleteState?.motionStage).toBe('enter-white')
      expect(enterCompleteState?.whiteAlpha).toBeCloseTo(1, 5)
      expectSceneBudgets(enterCompleteState, viewport, 'enter-0840')
      const enterComplete = await captureFrame(page, canvas, 'enter-0840', viewport, testInfo)
      const enterCompleteWhiteRatio = await whitePixelRatio(enterComplete)
      expect(
        enterCompleteWhiteRatio,
        `${viewport.label} enter +0.84s white pixel ratio was ${(enterCompleteWhiteRatio * 100).toFixed(3)}%`
      ).toBeGreaterThanOrEqual(0.995)

      const finalState = await page.evaluate(() => ({
        debug: window.__launchSceneVisual?.debug(),
        milestones: window.__launchSceneVisual?.milestones
      }))
      expect(finalState.debug?.phase).toBe('entering')
      expect(finalState.debug?.motionStage).toBe('enter-white')
      expect(finalState.milestones?.some(milestone => milestone.stage === 'gate-forming')).toBe(true)
      expect(finalState.milestones?.some(milestone => milestone.stage === 'gate-ready')).toBe(true)
      expect(shaderErrors).toEqual([])

      await page.evaluate(() => window.__launchSceneVisual?.dispose())
      await expect(page.locator('.yurisa-launch')).toHaveCount(0)
      expect(
        gateFormingElapsedMs,
        `${viewport.label} gate-forming contract: ${JSON.stringify(gateTimingReport)}`
      ).toBeLessThanOrEqual(2_430)
    })
  }
})

test.describe('Genshin production bootstrap and real-scene lifecycle', () => {
  test.describe.configure({ mode: 'serial' })

  test('1440x900 real runtime enters, finalizes at 2.1s and reveals a stable Hero', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'SwiftShader lifecycle evidence is Chromium-owned')
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    const runtimeRequests: string[] = []
    page.on('request', request => {
      if (/\/assets\/launch\/assets\/runtime\.[A-Za-z0-9_-]+\.js$/.test(new URL(request.url()).pathname)) {
        runtimeRequests.push(new URL(request.url()).pathname)
      }
    })
    const harness = await installProductionAuditHarness(page)
    await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })

    const ready = await waitForProductionReady(page)
    expect(ready.referenceProfile).toBe('090cb90-r150')
    expect(ready.rendererMemory.geometries).toBeGreaterThan(2)
    expect(ready.rendererMemory.textures).toBeGreaterThan(1)
    expectSceneBudgets(ready, viewports[1], 'production-bootstrap-ready')
    expect(runtimeRequests).toContain(harness.realEntry)

    const host = page.locator('body > .yurisa-launch')
    const primary = host.locator('[data-action="primary"]')
    const travelPhase = await primary.evaluate(button => {
      ;(button as HTMLButtonElement).click()
      return button.closest<HTMLElement>('.yurisa-launch')?.dataset.phase
    })
    expect(travelPhase).toBe('travelling')
    await expect(host).toHaveAttribute('data-phase', 'gate-ready', { timeout: 10_000 })
    await expect(primary).toContainText('点击进入博客')
    const enterStartedAt = await primary.evaluate(button => {
      const startedAt = performance.now()
      ;(button as HTMLButtonElement).click()
      return startedAt
    })
    await expect(host).toHaveAttribute('data-phase', 'entering')
    await page.waitForFunction(() => {
      const audit = (window as typeof window & {
        __realProductionLaunchAudit?: ProductionAudit
      }).__realProductionLaunchAudit
      return audit?.hostRemovalTimes.some(removal => removal.generation === 1)
    }, undefined, { timeout: 8_000 })
    await expectProductionUnlocked(page)
    await page.waitForFunction(() => {
      const audit = (window as typeof window & {
        __realProductionLaunchAudit?: ProductionAudit
      }).__realProductionLaunchAudit
      return audit?.completions.some(completion => completion.outcome === 'entered')
    }, undefined, { timeout: 15_000 })
    await page.waitForFunction(() => Boolean((window as typeof window & {
      __realProductionLaunchAudit?: ProductionAudit
    }).__realProductionLaunchAudit?.records[0]?.afterDispose))

    const audit = await page.evaluate(() => (window as typeof window & {
      __realProductionLaunchAudit: ProductionAudit
    }).__realProductionLaunchAudit)
    expect(audit.completions).toEqual([{ generation: 1, outcome: 'entered' }])
    expect(audit.hostAdds).toBe(1)
    expect(audit.hostRemoves).toBe(1)
    expect(audit.hostReappearedAfterCompletion).toBe(false)
    expect(audit.records).toHaveLength(1)
    expect(audit.records[0]?.realEntry).toBe(harness.realEntry)
    expect(audit.records[0]?.abortObserved).toBe(true)
    expect(audit.records[0]?.beforeDispose?.rendererMemory.geometries).toBeGreaterThan(2)
    expect(audit.records[0]?.beforeDispose?.rendererMemory.textures).toBeGreaterThan(1)
    expect(audit.records[0]?.afterDispose?.rendererMemory).toEqual({ geometries: 0, textures: 0 })
    expect(audit.records[0]?.afterDispose?.disposed).toBe(true)
    expect(audit.records[0]?.afterDispose?.activeRaf).toBe(false)
    const enteredAt = audit.completionTimes.find(item => item.outcome === 'entered')?.timeMs
    const removedAt = audit.hostRemovalTimes.find(item => item.generation === 1)?.timeMs
    const enterElapsedMs = (removedAt ?? Number.POSITIVE_INFINITY) - enterStartedAt
    const cleanupElapsedMs = (enteredAt ?? Number.POSITIVE_INFINITY) - (removedAt ?? 0)
    expect(enterElapsedMs, 'real Hero handoff must not precede the 2.1s white hold')
      .toBeGreaterThanOrEqual(2_050)
    expect(enterElapsedMs, 'real Hero handoff exceeded the CI lifecycle bound')
      .toBeLessThanOrEqual(6_000)
    expect(cleanupElapsedMs, 'launch-complete fired before post-handoff cleanup')
      .toBeGreaterThanOrEqual(0)
    expect(cleanupElapsedMs, 'post-handoff cleanup exceeded the CI lifecycle bound')
      .toBeLessThanOrEqual(10_000)
    await testInfo.attach('launch-real-enter-timing.json', {
      body: Buffer.from(`${JSON.stringify({
        enterStartedAt,
        removedAt,
        enteredAt,
        enterElapsedMs,
        cleanupElapsedMs
      }, null, 2)}\n`),
      contentType: 'application/json'
    })
    console.info(`[launch-real-enter-timing] ${JSON.stringify({
      enterStartedAt,
      removedAt,
      enteredAt,
      enterElapsedMs,
      cleanupElapsedMs
    })}`)

    await stabilizeProductionHero(page)
    const heroSamples = await page.evaluate(async () => {
      const samples: Array<{
        hostCount: number
        activeClass: boolean
        inert: boolean
        heroVisible: boolean
      }> = []
      for (let index = 0; index < 4; index += 1) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        const hero = document.querySelector<HTMLElement>('#site-title')
        const bodyWrap = document.querySelector<HTMLElement>('#body-wrap')
        const style = hero ? getComputedStyle(hero) : null
        const rect = hero?.getBoundingClientRect()
        samples.push({
          hostCount: document.querySelectorAll('body > .yurisa-launch').length,
          activeClass: document.documentElement.classList.contains('yurisa-launch-active') ||
            document.body.classList.contains('yurisa-launch-active'),
          inert: Boolean(bodyWrap?.inert || bodyWrap?.hasAttribute('inert')),
          heroVisible: Boolean(
            hero && style && rect && rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
          )
        })
      }
      return samples
    })
    expect(heroSamples).toHaveLength(4)
    for (const sample of heroSamples) {
      expect(sample).toEqual({
        hostCount: 0,
        activeClass: false,
        inert: false,
        heroVisible: true
      })
    }
    const screenshotOptions = {
      animations: 'disabled' as const,
      caret: 'hide' as const,
      fullPage: false,
      maxDiffPixelRatio: 0.003,
      scale: 'css' as const,
      threshold: 0.2
    }
    await expect(page).toHaveScreenshot(
      'launch-real-handoff-hero-1440x900.png',
      screenshotOptions
    )
  })

  test('real WebGL context loss fails open and disables replay', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'SwiftShader lifecycle evidence is Chromium-owned')
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await installProductionAuditHarness(page)
    await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })
    const ready = await waitForProductionReady(page)
    expectSceneBudgets(ready, viewports[1], 'context-loss-ready')

    const lost = await page.locator('.yurisa-launch__canvas').evaluate(canvas => {
      const context = (canvas as HTMLCanvasElement).getContext('webgl2')
      const extension = context?.getExtension('WEBGL_lose_context')
      if (!extension) return false
      extension.loseContext()
      return true
    })
    expect(lost, 'SwiftShader did not expose WEBGL_lose_context').toBe(true)
    await page.waitForFunction(() => (window as typeof window & {
      __realProductionLaunchAudit?: ProductionAudit
    }).__realProductionLaunchAudit?.completions.some(item => item.outcome === 'fallback'), undefined, {
      timeout: 15_000
    })
    await expectProductionUnlocked(page)
    await expect(page.locator('#genshin-launch-replay-btn')).toBeDisabled()
    expect(await page.evaluate(() => (window as typeof window & {
      __genshinLaunch: { start(source: string): boolean }
    }).__genshinLaunch.start('replay'))).toBe(false)
    const audit = await page.evaluate(() => (window as typeof window & {
      __realProductionLaunchAudit: ProductionAudit
    }).__realProductionLaunchAudit)
    expect(audit.completions).toEqual([{ generation: 1, outcome: 'fallback' }])
    expect(audit.records[0]?.afterDispose?.rendererMemory).toEqual({ geometries: 0, textures: 0 })
    expect(audit.records[0]?.afterDispose?.disposed).toBe(true)
  })

  for (const resourceCase of [
    { label: 'required GLB', assetId: 'model.column01' },
    { label: 'required PNG', assetId: 'texture.light' }
  ]) {
    test(`aborted ${resourceCase.label} fails open to Hero and disables replay`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'SwiftShader lifecycle evidence is Chromium-owned')
      test.setTimeout(90_000)
      await page.setViewportSize({ width: 1440, height: 900 })
      const harness = await installProductionAuditHarness(page, resourceCase.assetId)
      await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => (window as typeof window & {
        __realProductionLaunchAudit?: ProductionAudit
      }).__realProductionLaunchAudit?.completions.some(item => item.outcome === 'fallback'), undefined, {
        timeout: 45_000
      })
      expect(harness.getAbortedRequests(), `${resourceCase.assetId} was not intercepted`).toBeGreaterThan(0)
      await expectProductionUnlocked(page)
      await expect(page.locator('#genshin-launch-replay-btn')).toBeDisabled()
      expect(await page.evaluate(() => (window as typeof window & {
        __genshinLaunch: { start(source: string): boolean }
      }).__genshinLaunch.start('replay'))).toBe(false)
      const audit = await page.evaluate(() => (window as typeof window & {
        __realProductionLaunchAudit: ProductionAudit
      }).__realProductionLaunchAudit)
      expect(audit.completions).toEqual([{ generation: 1, outcome: 'fallback' }])
      expect(audit.hostAdds).toBe(1)
      expect(audit.hostRemoves).toBe(1)
      expect(audit.records[0]?.afterDispose?.rendererMemory).toEqual({ geometries: 0, textures: 0 })
      expect(audit.records[0]?.afterDispose?.disposed).toBe(true)
    })
  }

  test('five real replay generations release every canvas, RAF and renderer allocation', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'SwiftShader lifecycle evidence is Chromium-owned')
    test.setTimeout(300_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    const harness = await installProductionAuditHarness(page)
    await page.goto('/?launch=preview', { waitUntil: 'domcontentloaded' })

    for (let round = 0; round < 5; round += 1) {
      const ready = await waitForProductionReady(page)
      expect(ready.referenceProfile, `generation ${round + 1} reference profile`).toBe('090cb90-r150')
      expect(ready.rendererMemory.geometries, `generation ${round + 1} geometries`).toBeGreaterThan(2)
      expect(ready.rendererMemory.textures, `generation ${round + 1} textures`).toBeGreaterThan(1)
      expectSceneBudgets(ready, viewports[1], `replay-${round + 1}-ready`)
      await page.keyboard.press('Escape')
      await page.waitForFunction(expected => {
        const audit = (window as typeof window & {
          __realProductionLaunchAudit?: ProductionAudit
        }).__realProductionLaunchAudit
        return (audit?.completions.length ?? 0) >= expected &&
          Boolean(audit?.records[expected - 1]?.afterDispose)
      }, round + 1)
      await expectProductionUnlocked(page)

      const record = await page.evaluate(index => (window as typeof window & {
        __realProductionLaunchAudit: ProductionAudit
      }).__realProductionLaunchAudit.records[index], round)
      expect(record.generation).toBe(round + 1)
      expect(record.realEntry).toBe(harness.realEntry)
      expect(record.abortObserved).toBe(true)
      expect(record.beforeDispose?.rendererMemory.geometries).toBeGreaterThan(2)
      expect(record.beforeDispose?.rendererMemory.textures).toBeGreaterThan(1)
      expect(record.afterDispose?.rendererMemory).toEqual({ geometries: 0, textures: 0 })
      expect(record.afterDispose?.disposed).toBe(true)
      expect(record.afterDispose?.activeRaf).toBe(false)

      if (round < 4) {
        const replay = page.locator('#genshin-launch-replay-btn')
        await expect(replay).toBeEnabled()
        await replay.dispatchEvent('click')
        await expect(page.locator('body > .yurisa-launch')).toHaveCount(1)
      }
    }

    const audit = await page.evaluate(() => {
      const target = window as typeof window & {
        __realProductionLaunchAudit: ProductionAudit
        __genshinLaunch: { getState(): { active: boolean } }
      }
      return {
        audit: target.__realProductionLaunchAudit,
        coordinator: target.__genshinLaunch.getState()
      }
    })
    expect(audit.audit.completions).toEqual(
      Array.from({ length: 5 }, (_, index) => ({ generation: index + 1, outcome: 'skipped' }))
    )
    expect(audit.audit.records).toHaveLength(5)
    expect(audit.audit.hostAdds).toBe(5)
    expect(audit.audit.hostRemoves).toBe(5)
    expect(audit.audit.hostReappearedAfterCompletion).toBe(false)
    expect(audit.coordinator).toEqual({ active: false })
    expect(audit.audit.escapeHandoffs).toHaveLength(5)
    const handoffSamples = audit.audit.escapeHandoffs.map(sample => sample.elapsedMs)
    const sortedHandoffs = [...handoffSamples].sort((left, right) => left - right)
    const p95Ms = sortedHandoffs[Math.ceil(sortedHandoffs.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY
    const handoffReport = {
      samples: audit.audit.escapeHandoffs,
      p95Ms,
      limitMs: 150
    }
    console.info(`[launch-real-unlock-handoff] ${JSON.stringify(handoffReport)}`)
    await testInfo.attach('launch-real-unlock-handoff.json', {
      body: Buffer.from(`${JSON.stringify(handoffReport, null, 2)}\n`),
      contentType: 'application/json'
    })
    for (const sample of audit.audit.escapeHandoffs) {
      expect(sample.unlocked, `generation ${sample.generation} was not unlocked before completion`).toBe(true)
      expect(sample.overflowUnlocked, `generation ${sample.generation} retained overflow lock`).toBe(true)
      expect(sample.heroVisible, `generation ${sample.generation} Hero was not visible`).toBe(true)
      expect(sample.scrollResponsive, `generation ${sample.generation} did not respond to auto scroll`).toBe(true)
      expect(sample.elapsedMs, `generation ${sample.generation} Escape handoff`).toBeLessThanOrEqual(150)
    }
    expect(p95Ms, `five-generation real Escape handoff p95: ${JSON.stringify(handoffReport)}`)
      .toBeLessThanOrEqual(150)
    await expectProductionUnlocked(page)
  })
})
