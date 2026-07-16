import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'
import sharp from 'sharp'

const UPSTREAM_COMMIT = '090cb905a53a078fb192fc7e3da2a7a679d35ff4'
const THREE_REVISION = '150'
const VIEWPORT = Object.freeze({ width: 1280, height: 720 })
const SIMULATION_VIEWPORT = Object.freeze({ width: 160, height: 90 })
const REFERENCE_EPOCH = '2023-10-08T00:00:00.000Z'
const MAX_FRAME_STEP_MS = 16
const EVIDENCE_FRAME_MS = 16
const READY_FRAME_COUNT = 2
const READY_RENDER_MS = EVIDENCE_FRAME_MS * READY_FRAME_COUNT
const EVIDENCE_FRAME_COUNT = 4
const EVIDENCE_RENDER_MS = EVIDENCE_FRAME_MS * EVIDENCE_FRAME_COUNT
const DOOR_FORMATION_SEMANTIC_MS = 1_458
const DOOR_FORMATION_RENDER_MS = 1_472
const RESOURCE_QUIESCENCE_MS = 1_000
const EXPECTED_VISUAL_RESOURCES = Object.freeze([
  '/Genshin/Login/DOOR.glb',
  '/Genshin/Login/SM_BigCloud.glb',
  '/Genshin/Login/SM_Light.glb',
  '/Genshin/Login/SM_Qiao01.glb',
  '/Genshin/Login/SM_Qiao02.glb',
  '/Genshin/Login/SM_Qiao03.glb',
  '/Genshin/Login/SM_Qiao04.glb',
  '/Genshin/Login/SM_Road.glb',
  '/Genshin/Login/SM_ZhuZi01.glb',
  '/Genshin/Login/SM_ZhuZi02.glb',
  '/Genshin/Login/SM_ZhuZi03.glb',
  '/Genshin/Login/SM_ZhuZi04.glb',
  '/Genshin/Login/WHITE_PLANE.glb',
  '/Genshin/Login/Textures/Tex_0062.png',
  '/Genshin/Login/Textures/Tex_0063.png',
  '/Genshin/Login/Textures/Tex_0067b.png',
  '/Genshin/Login/Textures/Tex_0071.png',
  '/Genshin/Login/Textures/Tex_0075.png'
])
const CHROMIUM_ARGS = Object.freeze([
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader'
])
const PROVENANCE_SOURCE_FILES = Object.freeze([
  'package.json',
  'src/core/Game.ts',
  'src/core/components/BloomTransition.ts',
  'src/core/components/ForwardCamera.ts',
  'src/core/components/Materials.ts',
  'src/core/components/Road.ts',
  'src/core/components/gradientBackground.ts',
  'src/shader/chunk/ACES.chunk.ts'
])

function argument (name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

async function run (command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${stderr}`)
  return stdout.trim()
}

async function waitForServer (url, child, getOutput = () => '') {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`upstream Vite exited with ${child.exitCode}:\n${getOutput()}`)
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${url}`)
}

async function sha256File (filePath) {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

async function whitePixelRatio (filePath, minimum = 248) {
  const { data, info } = await sharp(filePath).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  let white = 0
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index] >= minimum && data[index + 1] >= minimum && data[index + 2] >= minimum) white++
  }
  return white / (info.width * info.height)
}

async function withHostTimeout (promise, label, timeoutMs = 300_000) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForPageState (page, label, evaluate, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await page.evaluate(evaluate)
      if (value) return value
    } catch {
      // Vite modules or the React root may still be initializing.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${label} was not ready within ${timeoutMs}ms`)
}

async function waitForVisualResourceQuiescence (page, tracker, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let stableSince = 0
  let previousSignature = ''
  while (Date.now() < deadline) {
    const paths = [...tracker.finishedPaths].sort()
    const snapshot = {
      paths,
      missing: EXPECTED_VISUAL_RESOURCES.filter(pathname => !tracker.finishedPaths.has(pathname))
    }
    const signature = snapshot.paths.join('\n')
    const now = Date.now()
    if (snapshot.missing.length === 0 && tracker.pending.size === 0 && signature === previousSignature) {
      if (stableSince === 0) stableSince = now
      if (now - stableSince >= RESOURCE_QUIESCENCE_MS) {
        // StatePreload transfers to StateGame through chained promises. Give
        // the cached viewer.load() callbacks one final microtask checkpoint so
        // columns, BigCloud and PolarLight are in the scene before frame zero.
        await page.evaluate(async () => {
          await Promise.resolve()
          await Promise.resolve()
        })
        return snapshot.paths
      }
    } else {
      stableSince = snapshot.missing.length === 0 && tracker.pending.size === 0 ? now : 0
      previousSignature = signature
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const missing = EXPECTED_VISUAL_RESOURCES.filter(pathname => !tracker.finishedPaths.has(pathname))
  throw new Error(
    `upstream visual resources did not quiesce; missing: ${missing.join(', ') || 'none'}; ` +
    `pending: ${tracker.pending.size}; observed: ${[...tracker.finishedPaths].sort().join(', ') || 'none'}`
  )
}

async function waitForSceneGraphQuiescence (page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let previousSignature = ''
  let stableSince = 0
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => {
      const scene = globalThis.__genshinReferenceRoad?.viewer?.scene
      if (!scene) return null
      const state = {
        objects: 0,
        meshes: 0,
        instancedMeshes: 0,
        points: 0,
        directChildren: scene.children.map(child => `${child.type}:${child.name}`)
      }
      scene.traverse(object => {
        state.objects += 1
        if (object.isMesh) state.meshes += 1
        if (object.isInstancedMesh) state.instancedMeshes += 1
        if (object.isPoints) state.points += 1
      })
      return state
    })
    if (snapshot) {
      const signature = JSON.stringify(snapshot)
      const now = Date.now()
      const complete =
        snapshot.meshes > 20 &&
        snapshot.instancedMeshes >= 4 &&
        snapshot.points >= 1
      if (complete && signature === previousSignature) {
        if (stableSince === 0) stableSince = now
        if (now - stableSince >= RESOURCE_QUIESCENCE_MS) return snapshot
      } else {
        stableSince = complete ? now : 0
        previousSignature = signature
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('upstream scene graph did not quiesce with columns, aurora and stars present')
}

async function publishCaptureDirectory (stagingDir, destinationDir) {
  const backupDir = `${destinationDir}.previous-${process.pid}`
  await fs.rm(backupDir, { recursive: true, force: true })
  let hasPrevious = false
  try {
    await fs.rename(destinationDir, backupDir)
    hasPrevious = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    await fs.rename(stagingDir, destinationDir)
  } catch (error) {
    if (hasPrevious) await fs.rename(backupDir, destinationDir)
    throw error
  }
  if (hasPrevious) await fs.rm(backupDir, { recursive: true, force: true })
}

const upstreamDir = path.resolve(argument('--upstream-dir', process.env.GENSHIN_UPSTREAM_DIR))
if (!process.env.GENSHIN_UPSTREAM_DIR && !argument('--upstream-dir')) {
  throw new Error('pass --upstream-dir or set GENSHIN_UPSTREAM_DIR to a checkout of www-genshin')
}
const outputDir = path.resolve(argument(
  '--output-dir',
  'tests/reference/genshin-launch/upstream-090cb90'
))
const seed = Number(argument('--seed', '240713'))
const port = Number(argument('--port', '4178'))
const baseUrl = `http://127.0.0.1:${port}`

const [head, sourceTree, checkoutStatus, xviewerSource] = await Promise.all([
  run('git', ['rev-parse', 'HEAD'], upstreamDir),
  run('git', ['rev-parse', 'HEAD^{tree}'], upstreamDir),
  run('git', ['status', '--porcelain', '--untracked-files=all'], upstreamDir),
  fs.readFile(path.join(upstreamDir, 'src/libs/xviewer/xviewer.module.min.js'), 'utf8')
])
if (head !== UPSTREAM_COMMIT) {
  throw new Error(`upstream checkout must be ${UPSTREAM_COMMIT}; received ${head}`)
}
if (!xviewerSource.includes('const m="150"')) {
  throw new Error('pinned xviewer bundle no longer identifies Three revision 150')
}
const statusLines = checkoutStatus ? checkoutStatus.split('\n') : []
const unexpectedStatus = statusLines.filter(line => line !== '?? package-lock.json')
if (unexpectedStatus.length > 0) {
  throw new Error(`upstream checkout has source modifications:\n${unexpectedStatus.join('\n')}`)
}
await fs.access(path.join(upstreamDir, 'node_modules'))
await fs.mkdir(path.dirname(outputDir), { recursive: true })
const captureDir = await fs.mkdtemp(path.join(
  path.dirname(outputDir),
  `.${path.basename(outputDir)}.capture-`
))
const captureViteConfig = path.join(captureDir, 'vite.reference.config.mjs')
const viteModuleUrl = pathToFileURL(
  path.join(upstreamDir, 'node_modules/vite/dist/node/index.js')
).href
const reactPluginUrl = pathToFileURL(
  path.join(upstreamDir, 'node_modules/@vitejs/plugin-react/dist/index.js')
).href
await fs.writeFile(captureViteConfig, `
import { defineConfig } from ${JSON.stringify(viteModuleUrl)}
import react from ${JSON.stringify(reactPluginUrl)}

export default defineConfig({
  root: ${JSON.stringify(upstreamDir)},
  plugins: [
    {
      name: 'genshin-reference-production-react-semantics',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/src/main.tsx')) {
          const transformed = code
            .replace('<React.StrictMode>', '')
            .replace('</React.StrictMode>', '')
          if (transformed === code) throw new Error('React.StrictMode wrapper was not found')
          return { code: transformed, map: null }
        }
        if (id.endsWith('/src/core/components/Road.ts')) {
          const marker = 'onLoad(): void {'
          const transformed = code.replace(
            marker,
            marker + '\\n        (globalThis as any).__genshinReferenceRoad = this;'
          )
          if (transformed === code) throw new Error('Road.onLoad instrumentation point was not found')
          return { code: transformed, map: null }
        }
        if (id.endsWith('/src/core/Game.ts')) {
          const marker = 'private _initScene() {'
          const transformed = code.replace(
            marker,
            marker + '\\n        (globalThis as any).__genshinReferenceStateGame = this;'
          )
          if (transformed === code) throw new Error('StateGame._initScene instrumentation point was not found')
          return { code: transformed, map: null }
        }
        return null
      }
    },
    react()
  ]
})
`)
const sourceFileHashes = Object.fromEntries(await Promise.all(
  PROVENANCE_SOURCE_FILES.map(async relativePath => [
    relativePath,
    await sha256File(path.join(upstreamDir, relativePath))
  ])
))
const generatedPackageLock = path.join(upstreamDir, 'package-lock.json')
let generatedPackageLockSha256 = null
try {
  generatedPackageLockSha256 = await sha256File(generatedPackageLock)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const server = spawn(
  'npm',
  [
    'run',
    'start',
    '--',
    '--config',
    captureViteConfig,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort'
  ],
  { cwd: upstreamDir, stdio: ['ignore', 'pipe', 'pipe'] }
)
let serverOutput = ''
server.stdout.on('data', chunk => { serverOutput += chunk })
server.stderr.on('data', chunk => { serverOutput += chunk })

const captures = []
let browser
let published = false
try {
  await waitForServer(baseUrl, server, () => serverOutput)
  browser = await chromium.launch({ args: [...CHROMIUM_ARGS] })
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  await context.addInitScript(referenceSeed => {
    let state = referenceSeed >>> 0
    Math.random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 0x100000000
    }
  }, seed)
  const page = await context.newPage()
  const visualRequestTracker = {
    pending: new Set(),
    finishedPaths: new Set()
  }
  const visualPath = request => {
    const pathname = new URL(request.url()).pathname
    return pathname.startsWith('/Genshin/') ? pathname : ''
  }
  page.on('request', request => {
    if (visualPath(request)) visualRequestTracker.pending.add(request)
  })
  page.on('requestfinished', request => {
    const pathname = visualPath(request)
    if (pathname) visualRequestTracker.finishedPaths.add(pathname)
    visualRequestTracker.pending.delete(request)
  })
  page.on('requestfailed', request => {
    visualRequestTracker.pending.delete(request)
  })
  page.setDefaultTimeout(300_000)
  await page.clock.install({ time: new Date(REFERENCE_EPOCH) })
  // install() starts at the requested wall time but continues ticking. Pause
  // before navigation so network/Draco speed cannot advance the author's
  // camera or road loop while visual resources are loading.
  await page.clock.pauseAt(new Date(REFERENCE_EPOCH))
  const cdp = await context.newCDPSession(page)
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  await waitForPageState(page, 'upstream canvas', () => Boolean(
    document.querySelector('canvas.webgl-canvas')
  ))
  await waitForPageState(page, 'upstream visual resources', async () => {
    const { gameManager } = await import('/src/core/GameManager.ts')
    return gameManager.progress >= 1
  }, 120_000)
  const visualResourcePaths = await waitForVisualResourceQuiescence(page, visualRequestTracker)
  console.log(`[launch:reference] ${visualResourcePaths.length} visual resource requests quiesced`)
  const activeRoadInitialState = await waitForPageState(page, 'active Road component', () => {
    const road = globalThis.__genshinReferenceRoad
    if (!road?.obj?.children?.length) return false
    return {
      childNames: road.obj.children.map(child => child.name),
      childZ: road.obj.children.map(child => child.position.z),
      roadUnitLength: road.RoadUnitLength,
      loopLength: road.zLength
    }
  }, 120_000)
  console.log(
    `[launch:reference] active Road child[0]=${activeRoadInitialState.childNames[0]} ` +
    `z=${activeRoadInitialState.childZ[0]}`
  )
  const sceneGraphState = await waitForSceneGraphQuiescence(page)
  console.log(`[launch:reference] scene graph quiesced ${JSON.stringify(sceneGraphState)}`)
  await page.evaluate(async () => {
    const { PostprocessingPlugin, RenderPlugin } = await import('/src/libs/xviewer/index.js')
    globalThis.__genshinReferenceRenderEnabled = true
    globalThis.__genshinReferenceSetRenderEnabled = enabled => {
      globalThis.__genshinReferenceRenderEnabled = Boolean(enabled)
    }
    for (const Plugin of [RenderPlugin, PostprocessingPlugin]) {
      const original = Plugin.prototype.update
      if (typeof original !== 'function') throw new Error(`${Plugin.name}.update is unavailable`)
      Plugin.prototype.update = function (...args) {
        if (!globalThis.__genshinReferenceRenderEnabled) return undefined
        return original.apply(this, args)
      }
    }
  })
  await page.addStyleTag({
    content: '.menu-container,.progress-container{display:none!important}'
  })
  await page.evaluate(async () => {
    const { gameManager } = await import('/src/core/GameManager.ts')
    window.__genshinReferenceGateForming = false
    window.__genshinReferenceRestartRequested = false
    // The locked demo navigates to Bilibili after its terminal 2.1s timeline.
    // A maintainer capture must keep the same animation state without allowing
    // that unrelated outbound navigation to destroy the evidence context.
    gameManager.restart = () => {
      window.__genshinReferenceRestartRequested = true
    }
    gameManager.on('doorCreateBegin', () => {
      window.__genshinReferenceGateForming = true
    })
  })
  // The clock stays paused while network resources load, so the canonical
  // ready frame is semantic rather than dependent on host/GPU load time. Two
  // native frames initialize the author's viewer/post stack and start its
  // -88u/s cruise without publishing a half-initialized render target.
  await withHostTimeout(page.clock.runFor(READY_RENDER_MS), 'semantic ready frames')
  const advanceClock = (milliseconds, label) => withHostTimeout((async () => {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new Error(`clock advance must be a non-negative finite duration: ${label}`)
    }
    let remainingMs = milliseconds
    while (remainingMs > 0) {
      // RAF callbacks, Tween.js and AnimationMixer must observe the same small
      // deltas as an actual display. Only the viewer's two render plugins are
      // paused between milestones; WebGL itself is never partially executed.
      const stepMs = Math.min(MAX_FRAME_STEP_MS, remainingMs)
      await page.clock.runFor(stepMs)
      remainingMs -= stepMs
    }
  })(), `clock advance ${label}`)
  const advanceUntil = (predicate, maximumMs, label) => withHostTimeout((async () => {
    if (!Number.isFinite(maximumMs) || maximumMs <= 0) {
      throw new Error(`clock predicate deadline must be a positive finite duration: ${label}`)
    }
    let elapsedMs = 0
    while (elapsedMs < maximumMs) {
      const stepMs = Math.min(MAX_FRAME_STEP_MS, maximumMs - elapsedMs)
      await page.clock.runFor(stepMs)
      elapsedMs += stepMs
      if (await page.evaluate(predicate)) return elapsedMs
    }
    throw new Error(`${label} was not reached within ${maximumMs}ms`)
  })(), `clock predicate ${label}`)
  const capture = async (name, elapsedMs, renderedElapsedMs = elapsedMs) => {
    const filePath = path.join(captureDir, `${name}.png`)
    // The upstream canvas intentionally animates forever. Playwright's public
    // screenshot API waits for visual stability, so capture the current
    // compositor surface directly through CDP.
    const clip = await withHostTimeout(page.evaluate(() => {
      const element = document.querySelector('canvas.webgl-canvas')
      if (!(element instanceof HTMLCanvasElement) || !element.isConnected) {
        throw new Error('upstream canvas disappeared before evidence capture')
      }
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) throw new Error('upstream canvas has no capture area')
      const context = element.getContext('webgl2') || element.getContext('webgl')
      context?.finish?.()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 }
    }), `${name} canvas clip`)
    const screenshot = await withHostTimeout(cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip
    }), `${name} CDP screenshot`)
    await fs.writeFile(filePath, Buffer.from(screenshot.data, 'base64'))
    const metadata = await sharp(filePath).metadata()
    if (metadata.width !== VIEWPORT.width || metadata.height !== VIEWPORT.height) {
      throw new Error(
        `${name} evidence is ${metadata.width}x${metadata.height}; expected ${VIEWPORT.width}x${VIEWPORT.height}`
      )
    }
    const runtimeState = await page.evaluate(async () => {
      const { cameraCenter } = await import('/src/core/components/ForwardCamera.ts')
      return {
        cameraZ: globalThis.__genshinReferenceRoad?.viewer?.camera?.position?.z,
        cameraCenterZ: cameraCenter?.z
      }
    })
    if (!Number.isFinite(runtimeState.cameraZ) || !Number.isFinite(runtimeState.cameraCenterZ)) {
      throw new Error(`${name} camera state is unavailable`)
    }
    const evidence = {
      name,
      elapsedMs,
      ...(renderedElapsedMs !== elapsedMs ? { renderedElapsedMs } : {}),
      file: path.basename(filePath),
      width: metadata.width,
      height: metadata.height,
      cameraZ: runtimeState.cameraZ,
      cameraCenterZ: runtimeState.cameraCenterZ,
      sha256: await sha256File(filePath)
    }
    captures.push(evidence)
    console.log(`[launch:reference] captured ${name} at ${elapsedMs}ms (${evidence.sha256.slice(0, 12)})`)
  }

  const setViewport = async (viewport) => {
    await page.setViewportSize(viewport)
    await withHostTimeout(page.evaluate(() => {
      window.dispatchEvent(new Event('resize'))
      const element = document.querySelector('canvas.webgl-canvas')
      if (!(element instanceof HTMLCanvasElement) || !element.isConnected) {
        throw new Error('upstream canvas disappeared after resize')
      }
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) throw new Error('upstream canvas collapsed after resize')
    }), `resize canvas to ${viewport.width}x${viewport.height}`)
  }

  const captureAfter = async (
    name,
    advanceMs,
    elapsedMs,
    renderedElapsedMs = elapsedMs
  ) => {
    if (advanceMs < EVIDENCE_RENDER_MS) {
      throw new Error(`capture advance must be at least ${EVIDENCE_RENDER_MS}ms: ${name}`)
    }
    await setViewport(SIMULATION_VIEWPORT)
    await advanceClock(advanceMs - EVIDENCE_RENDER_MS, `${name} low-resolution simulation`)
    await setViewport(VIEWPORT)
    await page.evaluate(() => globalThis.__genshinReferenceSetRenderEnabled(true))
    await advanceClock(EVIDENCE_RENDER_MS, `${name} full-resolution evidence frames`)
    await capture(name, elapsedMs, renderedElapsedMs)
    await page.evaluate(() => globalThis.__genshinReferenceSetRenderEnabled(false))
    await setViewport(SIMULATION_VIEWPORT)
  }

  await capture('ready', 0)
  await page.evaluate(() => globalThis.__genshinReferenceSetRenderEnabled(false))
  await setViewport(SIMULATION_VIEWPORT)
  await page.evaluate(async () => {
    const { gameManager } = await import('/src/core/GameManager.ts')
    gameManager.emit('start')
  })
  // The initial road segment starts part-way through its loop. Stop on the
  // exact RAF that emits doorCreateBegin instead of assuming a full/half-loop
  // distance and accidentally advancing the door animation past its zero point.
  const seamElapsed = await advanceUntil(
    () => window.__genshinReferenceGateForming === true,
    2_500,
    'upstream road seam / gate-forming event'
  )
  console.log(`[launch:reference] gate-forming event at ${seamElapsed}ms after start`)
  await captureAfter('road-rise-0600', 600, seamElapsed + 600)
  await captureAfter(
    'door-formed-1458',
    DOOR_FORMATION_RENDER_MS - 600,
    seamElapsed + DOOR_FORMATION_SEMANTIC_MS,
    seamElapsed + DOOR_FORMATION_RENDER_MS
  )
  const doorFreezeState = await page.evaluate(() => {
    const road = globalThis.__genshinReferenceRoad
    return {
      mixerTimes: road?.mixerList?.map(mixer => mixer.time) || [],
      doorHasCreate: Boolean(road?.doorHasCreate),
      hasLoadBackground: Boolean(road?.hasLoadBackground)
    }
  })
  console.log(`[launch:reference] door freeze state ${JSON.stringify(doorFreezeState)}`)
  if (await page.locator('.menu-doorCreate-content').count() === 0) {
    throw new Error('upstream door did not freeze after its 1.458 second formation')
  }
  await captureAfter(
    'road-settled-2000',
    2_000 - DOOR_FORMATION_RENDER_MS,
    seamElapsed + 2_000
  )
  const gateStableElapsed = seamElapsed + 5_000
  await captureAfter('gate-stable-5000', 3_000, gateStableElapsed)

  // Invoke the exact transition method registered by the author's pointer
  // handler. Dispatching a synthetic DOM pointer can land on either side of a
  // Playwright Clock RAF boundary, which makes the 0.5s and 0.7s evidence
  // frames non-deterministic even though the rendered transition is identical.
  await withHostTimeout(page.evaluate(() => {
    const state = globalThis.__genshinReferenceStateGame
    if (!state || typeof state._jump !== 'function') {
      throw new Error('upstream enter transition method is unavailable')
    }
    state._jump()
  }), 'enter transition dispatch')
  let previousEnterElapsed = 0
  for (const [name, elapsed] of [['enter-0500', 500], ['enter-0700', 700], ['enter-0840', 840]]) {
    await captureAfter(name, elapsed - previousEnterElapsed, gateStableElapsed + elapsed)
    const transitionUniforms = await page.evaluate(() => {
      const effect = globalThis.__genshinReferenceStateGame?._BloomTransition?.effect
      return {
        intensity: effect?.uniforms?.get('intensity')?.value,
        whiteAlpha: effect?.uniforms?.get('whiteAlpha')?.value
      }
    })
    if (
      !Number.isFinite(transitionUniforms.intensity) ||
      !Number.isFinite(transitionUniforms.whiteAlpha)
    ) {
      throw new Error(`${name} transition uniforms are unavailable`)
    }
    captures[captures.length - 1].enterElapsedMs = elapsed
    // Preserve the actual TweenManager/RAF sample that produced the evidence
    // pixels. The nominal +500/+700/+840ms labels intentionally describe the
    // capture clock, while the author's timeline updates on the preceding RAF.
    captures[captures.length - 1].transitionUniforms = transitionUniforms
    previousEnterElapsed = elapsed
    const ratio = await whitePixelRatio(path.join(captureDir, `${name}.png`))
    captures[captures.length - 1].whitePixelRatio = ratio
    if (elapsed >= 700 && ratio < 0.995) {
      throw new Error(`${name} is not a valid white reference: ${(ratio * 100).toFixed(3)}% white pixels`)
    }
  }

  const provenance = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceRepository: 'https://github.com/gamemcu/www-genshin',
    sourceCommit: UPSTREAM_COMMIT,
    sourceTree,
    sourceVideo: 'https://www.bilibili.com/video/BV1E8411v7xy/',
    threeRevision: THREE_REVISION,
    referenceProfile: '090cb90-r150',
    sourceCheckout: {
      trackedFilesClean: unexpectedStatus.length === 0,
      generatedPackageLockSha256
    },
    runtimeSemantics: {
      reactStrictModeDevelopmentDoubleMountDisabled: true,
      reason: 'Match the single Canvas/Game mount used by React production builds; the Vite development-only double effect leaves a stale global GameManager listener.',
      enterTransitionDispatch: 'Direct invocation of the exact StateGame._jump method registered by the upstream DeviceInput pointer handler, avoiding a synthetic-event/RAF boundary race.',
      enterTransitionUniforms: 'Captured from BloomTransition.effect immediately after each evidence frame so nominal capture time remains distinguishable from TweenManager\'s preceding-RAF sample.',
      activeRoadInitialState
    },
    sourceFiles: sourceFileHashes,
    visualResourceQuiescence: {
      requiredPaths: EXPECTED_VISUAL_RESOURCES,
      observedPathCount: visualResourcePaths.length,
      stableForMs: RESOURCE_QUIESCENCE_MS
    },
    sceneGraphQuiescence: sceneGraphState,
    browser: {
      name: 'chromium',
      version: browser.version(),
      args: CHROMIUM_ARGS
    },
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    seed,
    clock: {
      epoch: REFERENCE_EPOCH,
      mode: 'Playwright Clock explicitly pauseAt() before navigation/resource loading, then runFor() in chronological steps no larger than 16ms',
      simulationViewport: SIMULATION_VIEWPORT,
      evidenceViewport: VIEWPORT,
      maximumFrameStepMs: MAX_FRAME_STEP_MS,
      evidenceFrameMs: EVIDENCE_FRAME_MS,
      readyFrameCount: READY_FRAME_COUNT,
      readyRenderMs: READY_RENDER_MS,
      evidenceFrameCount: EVIDENCE_FRAME_COUNT,
      gateTriggerElapsedMs: seamElapsed,
      doorFormationSemanticMs: DOOR_FORMATION_SEMANTIC_MS,
      doorFormationRenderedMs: DOOR_FORMATION_RENDER_MS,
      simulationDrawCallsSuppressed: false,
      simulationRenderPluginsPaused: true
    },
    captureNotes: 'Canvas-only 1280x720 maintainer reference. Animation/Tween callbacks advance at <=16ms while the upstream RenderPlugin and PostprocessingPlugin are paused between milestones; ready initializes with two native frames and every later PNG follows four native 1280x720 frames ending on its exact milestone. No WebGL method is monkeypatched. The demo terminal Bilibili navigation is suppressed without changing its animation timeline. PR jobs consume checked-in PNGs and never rebuild upstream.',
    captures
  }
  const expectedCaptureNames = [
    'ready',
    'road-rise-0600',
    'door-formed-1458',
    'road-settled-2000',
    'gate-stable-5000',
    'enter-0500',
    'enter-0700',
    'enter-0840'
  ]
  if (JSON.stringify(captures.map(item => item.name)) !== JSON.stringify(expectedCaptureNames)) {
    throw new Error(`capture set is incomplete: ${captures.map(item => item.name).join(', ')}`)
  }
  await fs.writeFile(path.join(captureDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`)
  await context.close()
  // The Vite config contains checkout-specific absolute paths and exists only
  // to boot the maintainer capture. Never publish it with portable evidence.
  await fs.rm(captureViteConfig, { force: true })
  await publishCaptureDirectory(captureDir, outputDir)
  published = true
} finally {
  await browser?.close().catch(() => undefined)
  server.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 100))
  if (server.exitCode === null) server.kill('SIGKILL')
  if (!published) await fs.rm(captureDir, { recursive: true, force: true })
}

console.log(`[launch:reference] wrote ${captures.length} captures to ${outputDir}`)
if (serverOutput && captures.length === 0) console.error(serverOutput)
