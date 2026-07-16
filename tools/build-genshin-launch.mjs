import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { minify } from 'terser'

const execFileAsync = promisify(execFile)
const DERIVATION_RECIPE = 'v4-original-png-mobile-q85-e4-mp3-128k-48k'
const SOURCE_SCHEMA_VERSION = 1
const VALID_TIERS = new Set([0, 1, 2])

const ROOT = process.cwd()
const SOURCE_MANIFEST = path.join(ROOT, 'launch', 'asset-source-manifest.json')
const VENDOR_ROOT = path.join(ROOT, 'vendor', 'genshin-launch', 'original')
const OUT_ROOT = path.join(ROOT, 'public', 'assets', 'launch')
const OUT_ASSETS = path.join(OUT_ROOT, 'assets')
const CACHE_ROOT = path.join(ROOT, '.cache', 'genshin-launch')
const WORK_MAP = path.join(CACHE_ROOT, 'asset-map.json')
const VITE_MANIFEST = path.join(OUT_ASSETS, 'vite-manifest.json')
const RUNTIME_MANIFEST = path.join(OUT_ROOT, 'manifest.json')
const DRACO_SOURCE = path.join(
  ROOT,
  'node_modules',
  'three',
  'examples',
  'jsm',
  'libs',
  'draco',
  'gltf'
)

const LIMITS = Object.freeze({
  readyVisual: 3.5 * 1024 * 1024,
  visual: 4.5 * 1024 * 1024,
  shellGzip: 60 * 1024,
  bootstrapGzip: 8 * 1024,
  jsSoftGzip: 200 * 1024,
  jsHardGzip: 220 * 1024,
  decoderGzip: 80 * 1024,
  jsAndDecoderGzip: 300 * 1024,
  cloudflareFile: 25 * 1024 * 1024,
  cloudflareFiles: 20000
})

function posix (value) {
  return value.split(path.sep).join('/')
}

function sha256 (buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function isWebp (buffer) {
  return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
}

function isMp3 (buffer) {
  if (buffer.length < 3) return false
  return buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
}

async function writeFileAtomic (filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(temporary, contents)
  await fs.rename(temporary, filePath)
}

async function minifyPublishedBootstrap () {
  const bootstrapFiles = [
    path.join(ROOT, 'public', 'js', 'genshin-launch-policies.js'),
    path.join(ROOT, 'public', 'js', 'genshin-launch.js')
  ]
  for (const filePath of bootstrapFiles) {
    let source
    try {
      source = await fs.readFile(filePath, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') continue
      throw error
    }
    const result = await minify(source, {
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false }
    })
    if (!result.code) throw new Error(`failed to minify launch bootstrap: ${filePath}`)
    await writeFileAtomic(filePath, `${result.code}\n`)
  }
}

function withHash (relativePath, hash) {
  const parsed = path.posix.parse(relativePath)
  return path.posix.join(parsed.dir, `${parsed.name}.${hash.slice(0, 12)}${parsed.ext}`)
}

function manifestPathToPosix (value) {
  return value.replace(/\\/g, '/')
}

function resolveContainedManifestPath (root, value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`)
  }
  if (value.includes('\0')) throw new Error(`${label} contains a null byte`)

  const normalizedSeparators = manifestPathToPosix(value)
  if (
    path.isAbsolute(value) ||
    path.posix.isAbsolute(normalizedSeparators) ||
    path.win32.isAbsolute(value)
  ) {
    throw new Error(`${label} must be relative: ${value}`)
  }
  if (normalizedSeparators.split('/').includes('..')) {
    throw new Error(`${label} must not contain "..": ${value}`)
  }

  const normalized = path.posix.normalize(normalizedSeparators)
  if (normalized === '.' || normalized === '') {
    throw new Error(`${label} must resolve to a file path`)
  }

  const absoluteRoot = path.resolve(root)
  const resolved = path.resolve(absoluteRoot, ...normalized.split('/'))
  const relative = path.relative(absoluteRoot, resolved)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} resolves outside ${absoluteRoot}: ${value}`)
  }
  return { normalized, resolved }
}

function normalizePublishPath (file) {
  let target = typeof file.publish === 'string' ? file.publish : file.relativePath
  target = manifestPathToPosix(target)
  target = target.replace(/^assets\/launch\/assets\//, '')
  return path.posix.normalize(target)
}

function normalizeIdList (ids, label) {
  if (!Array.isArray(ids)) throw new Error(`${label} must be an array`)
  const result = new Set()
  for (const id of ids) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error(`${label} contains an invalid ID`)
    }
    if (result.has(id)) throw new Error(`${label} contains duplicate ID "${id}"`)
    result.add(id)
  }
  return [...result].sort()
}

function sameIdList (left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function validateSourceManifest (
  source,
  { vendorRoot = VENDOR_ROOT, outputRoot = OUT_ASSETS } = {}
) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('launch asset source manifest must be an object')
  }
  if (source.schemaVersion !== SOURCE_SCHEMA_VERSION) {
    throw new Error(`launch asset source manifest schemaVersion must be ${SOURCE_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(source.files) || source.files.length === 0) {
    throw new Error('launch asset source manifest has no files')
  }

  const ids = new Set()
  const publishTargets = new Map()
  const sourcePaths = new Map()
  const normalizedPublishTargets = new Map()
  const requiredAssetIds = []
  const publishedAssetIds = []

  for (const [index, file] of source.files.entries()) {
    const prefix = `launch asset source manifest files[${index}]`
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error(`${prefix} must be an object`)
    }
    if (typeof file.id !== 'string' || file.id.trim() === '') {
      throw new Error(`${prefix}.id must be a non-empty string`)
    }
    if (ids.has(file.id)) throw new Error(`duplicate launch asset ID "${file.id}"`)
    ids.add(file.id)

    if (!VALID_TIERS.has(file.tier)) {
      throw new Error(`launch asset "${file.id}" tier must be an integer from 0 to 2`)
    }
    if (typeof file.critical !== 'boolean') {
      throw new Error(`launch asset "${file.id}" critical must be a boolean`)
    }
    if (file.publish !== undefined && file.publish !== false && typeof file.publish !== 'string') {
      throw new Error(`launch asset "${file.id}" publish must be a string or false`)
    }
    if (file.critical && file.publish === false) {
      throw new Error(`critical launch asset "${file.id}" cannot set publish to false`)
    }

    const sourcePath = resolveContainedManifestPath(
      vendorRoot,
      file.relativePath,
      `launch asset "${file.id}" source path`
    )
    sourcePaths.set(file.id, sourcePath.resolved)

    if (file.critical) requiredAssetIds.push(file.id)
    if (file.publish === false) continue

    const rawPublishPath = typeof file.publish === 'string' ? file.publish : file.relativePath
    resolveContainedManifestPath(
      outputRoot,
      rawPublishPath,
      `launch asset "${file.id}" publish path`
    )
    const normalizedTarget = normalizePublishPath(file)
    const publishedPath = resolveContainedManifestPath(
      outputRoot,
      normalizedTarget,
      `launch asset "${file.id}" normalized publish path`
    )
    const duplicateId = publishTargets.get(publishedPath.normalized)
    if (duplicateId) {
      throw new Error(
        `duplicate launch publish target "${publishedPath.normalized}" for "${duplicateId}" and "${file.id}"`
      )
    }
    publishTargets.set(publishedPath.normalized, file.id)
    normalizedPublishTargets.set(file.id, publishedPath.normalized)
    publishedAssetIds.push(file.id)
  }

  return {
    requiredAssetIds: requiredAssetIds.sort(),
    publishedAssetIds: publishedAssetIds.sort(),
    sourcePaths,
    publishTargets: normalizedPublishTargets
  }
}

export function assertAssetContract (contract, candidate, label = 'launch asset manifest') {
  if (!contract || typeof contract !== 'object') throw new Error(`${label} source contract is missing`)
  if (!candidate || typeof candidate !== 'object') throw new Error(`${label} is missing`)

  const expectedRequiredIds = normalizeIdList(contract.requiredAssetIds, 'source requiredAssetIds')
  const expectedPublishedIds = normalizeIdList(contract.publishedAssetIds, 'source publishedAssetIds')
  const declaredRequiredIds = normalizeIdList(candidate.requiredAssetIds, `${label}.requiredAssetIds`)
  if (!sameIdList(expectedRequiredIds, declaredRequiredIds)) {
    throw new Error(
      `${label} required asset IDs mismatch; expected ${expectedRequiredIds.join(', ')}, received ${declaredRequiredIds.join(', ')}`
    )
  }

  if (!candidate.assets || typeof candidate.assets !== 'object' || Array.isArray(candidate.assets)) {
    throw new Error(`${label}.assets must be an object`)
  }
  for (const id of expectedRequiredIds) {
    if (!Object.prototype.hasOwnProperty.call(candidate.assets, id)) {
      throw new Error(`${label} is missing required asset "${id}"`)
    }
    if (candidate.assets[id]?.critical !== true) {
      throw new Error(`${label} required asset "${id}" must remain critical`)
    }
  }

  const actualAssetIds = Object.keys(candidate.assets).sort()
  if (!sameIdList(expectedPublishedIds, actualAssetIds)) {
    throw new Error(
      `${label} published asset IDs mismatch; expected ${expectedPublishedIds.join(', ')}, received ${actualAssetIds.join(', ')}`
    )
  }
  const actualCriticalIds = actualAssetIds.filter(id => candidate.assets[id]?.critical === true)
  if (!sameIdList(expectedRequiredIds, actualCriticalIds)) {
    throw new Error(
      `${label} critical asset IDs mismatch; expected ${expectedRequiredIds.join(', ')}, received ${actualCriticalIds.join(', ')}`
    )
  }
}

function classify (relativePath) {
  const ext = path.extname(relativePath).toLowerCase()
  if (['.glb', '.gltf'].includes(ext)) return 'model'
  if (['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(ext)) return 'image'
  if (['.mp3', '.ogg', '.m4a', '.wav'].includes(ext)) return 'audio'
  return 'other'
}

function replaceExtension (relativePath, extension) {
  const parsed = path.posix.parse(relativePath)
  return path.posix.join(parsed.dir, `${parsed.name}${extension}`)
}

async function runFfmpeg (args) {
  try {
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  } catch (error) {
    throw new Error(`ffmpeg derivation failed: ${error.stderr || error.message}`)
  }
}

async function derivePublishedAsset (file, sourcePath, sourceBuffer, tempDir) {
  const rawTarget = normalizePublishPath(file)
  const lowerPath = file.relativePath.toLowerCase()
  const isBgm = file.id === 'audio.bgm' || /背景音乐|bgm/i.test(file.purpose || '')
  const sourceHash = sha256(sourceBuffer)

  if (isBgm && lowerPath.endsWith('.mp3')) {
    const cachePath = path.join(CACHE_ROOT, `${sourceHash}-${DERIVATION_RECIPE}.mp3`)
    const cached = await fs.readFile(cachePath).catch(() => null)
    if (cached && isMp3(cached)) {
      return {
        target: replaceExtension(rawTarget, '.mp3'),
        buffer: cached,
        derived: 'mp3-128k'
      }
    }
    const outputPath = path.join(tempDir, `${file.id.replace(/[^a-z0-9]+/gi, '-')}.mp3`)
    await runFfmpeg([
      '-i', sourcePath,
      '-map_metadata', '-1',
      '-vn',
      '-codec:a', 'libmp3lame',
      '-b:a', '128k',
      '-ar', '48000',
      outputPath
    ])
    const buffer = await fs.readFile(outputPath)
    await writeFileAtomic(cachePath, buffer)
    return {
      target: replaceExtension(rawTarget, '.mp3'),
      buffer,
      derived: 'mp3-128k'
    }
  }

  if (lowerPath.endsWith('.png')) {
    const mobileCache = path.join(CACHE_ROOT, `${sourceHash}-${DERIVATION_RECIPE}-mobile.webp`)
    const image = sharp(sourceBuffer, { failOn: 'error' })
    const metadata = await image.metadata()
    const dimensions = { width: metadata.width || 0, height: metadata.height || 0 }
    let mobileBuffer = sourceBuffer
    if (dimensions && Math.max(dimensions.width, dimensions.height) > 512) {
      mobileBuffer = await fs.readFile(mobileCache).catch(() => null)
      if (!mobileBuffer || !isWebp(mobileBuffer)) {
        mobileBuffer = await image
          .clone()
          .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85, effort: 4, smartSubsample: true })
          .toBuffer()
        await writeFileAtomic(mobileCache, mobileBuffer)
      }
    }
    return {
      // The cloud/light/star textures are masks and soft gradients. The
      // reference profile keeps the exact PNG bytes; q85 WebP visibly changes
      // their threshold edges. A 512 WebP is published only as a low-profile
      // fallback and is never selected by the high-fidelity baseline.
      target: replaceExtension(rawTarget, '.png'),
      buffer: sourceBuffer,
      mobileBuffer,
      derived: 'source-png',
      sourceDimensions: dimensions
    }
  }

  return {
    target: rawTarget,
    buffer: sourceBuffer,
    derived: 'copy'
  }
}

async function readJson (filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson (filePath, value) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function walk (dir) {
  const result = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await walk(fullPath))
    if (entry.isFile()) result.push(fullPath)
  }
  return result
}

async function prepare () {
  const source = await readJson(SOURCE_MANIFEST)
  const sourceContract = validateSourceManifest(source)

  await fs.rm(OUT_ROOT, { recursive: true, force: true })
  await fs.mkdir(OUT_ASSETS, { recursive: true })
  // Keep derivation scratch space outside OUT_ROOT. This prevents another
  // deterministic build that cleans public/assets/launch from deleting an
  // in-flight ffmpeg output before it can be read.
  await fs.mkdir(CACHE_ROOT, { recursive: true })
  const tempDir = await fs.mkdtemp(path.join(CACHE_ROOT, 'derive-'))

  const assets = Object.create(null)
  try {
    for (const file of source.files) {
      const sourcePath = sourceContract.sourcePaths.get(file.id)
      const sourceBuffer = await fs.readFile(sourcePath)
      const sourceHash = sha256(sourceBuffer)
      if (file.sha256 && file.sha256 !== sourceHash) {
        throw new Error(`hash mismatch for ${file.relativePath}`)
      }
      if (Number.isFinite(file.bytes) && file.bytes !== sourceBuffer.byteLength) {
        throw new Error(`size mismatch for ${file.relativePath}`)
      }
      if (file.publish === false) continue

      const derived = await derivePublishedAsset(file, sourcePath, sourceBuffer, tempDir)
      const publishedHash = sha256(derived.buffer)
      const targetRelative = withHash(derived.target, publishedHash)
      const outputPath = path.join(OUT_ASSETS, targetRelative)
      await fs.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.writeFile(outputPath, derived.buffer)

      const asset = {
        url: `/assets/launch/assets/${targetRelative}`,
        bytes: derived.buffer.byteLength,
        sha256: publishedHash,
        sourceBytes: sourceBuffer.byteLength,
        sourceSha256: sourceHash,
        derived: derived.derived,
        tier: Number(file.tier ?? 1),
        critical: Boolean(file.critical),
        kind: classify(targetRelative),
        purpose: file.purpose || ''
      }
      if (derived.mobileBuffer && !derived.mobileBuffer.equals(derived.buffer)) {
        const mobileHash = sha256(derived.mobileBuffer)
        const mobileTarget = withHash(replaceExtension(derived.target, '.mobile.webp'), mobileHash)
        const mobileOutputPath = path.join(OUT_ASSETS, mobileTarget)
        await fs.mkdir(path.dirname(mobileOutputPath), { recursive: true })
        await fs.writeFile(mobileOutputPath, derived.mobileBuffer)
        asset.mobileUrl = `/assets/launch/assets/${mobileTarget}`
        asset.mobileBytes = derived.mobileBuffer.byteLength
        asset.mobileSha256 = mobileHash
      }
      assets[file.id] = asset
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }

  assertAssetContract(sourceContract, {
    requiredAssetIds: sourceContract.requiredAssetIds,
    assets
  }, 'prepared launch asset map')

  const dracoTarget = path.join(OUT_ASSETS, 'draco-r185')
  await fs.mkdir(dracoTarget, { recursive: true })
  for (const fileName of ['draco_wasm_wrapper.js', 'draco_decoder.wasm']) {
    await fs.copyFile(path.join(DRACO_SOURCE, fileName), path.join(dracoTarget, fileName))
  }

  const map = {
    version: 1,
    sourceRepository: source.sourceRepository,
    sourceCommit: source.sourceCommit,
    requiredAssetIds: sourceContract.requiredAssetIds,
    assets
  }
  await writeJson(WORK_MAP, map)
  await writeJson(path.join(OUT_ROOT, 'source-manifest.json'), source)
  console.log(`[launch] prepared ${Object.keys(assets).length} published assets`)
}

async function finalize () {
  const [source, preparedSource, assetMap, viteManifest] = await Promise.all([
    readJson(SOURCE_MANIFEST),
    readJson(path.join(OUT_ROOT, 'source-manifest.json')),
    readJson(WORK_MAP),
    readJson(VITE_MANIFEST)
  ])
  const sourceContract = validateSourceManifest(source)
  validateSourceManifest(preparedSource)
  if (JSON.stringify(source) !== JSON.stringify(preparedSource)) {
    throw new Error('launch source manifest changed after prepare; run prepare again')
  }
  if (
    assetMap.sourceRepository !== source.sourceRepository ||
    assetMap.sourceCommit !== source.sourceCommit
  ) {
    throw new Error('prepared launch asset map source identity does not match source manifest')
  }
  assertAssetContract(sourceContract, assetMap, 'prepared launch asset map')

  const candidates = Object.entries(viteManifest)
    .filter(([, value]) => value && value.isEntry)
  const entry = candidates.find(([key]) => /(?:^|\/)entry\.ts$/.test(key)) || candidates[0]
  if (!entry) throw new Error('Vite did not emit a launch entry')

  const entryFile = entry[1].file
  const entryPath = path.join(OUT_ASSETS, entryFile)
  const entryBuffer = await fs.readFile(entryPath)
  const runtime = {
    version: 1,
    sourceRepository: assetMap.sourceRepository,
    sourceCommit: assetMap.sourceCommit,
    requiredAssetIds: sourceContract.requiredAssetIds,
    entry: `/assets/launch/assets/${entryFile}`,
    entryBytes: entryBuffer.byteLength,
    entrySha256: sha256(entryBuffer),
    dracoDecoderPath: '/assets/launch/assets/draco-r185/',
    assets: assetMap.assets
  }
  await writeJson(RUNTIME_MANIFEST, runtime)
  await fs.rm(VITE_MANIFEST, { force: true })
  const keep = new Set([entryFile])
  for (const value of Object.values(viteManifest)) {
    if (value && typeof value.file === 'string') keep.add(value.file)
  }
  for (const file of await walk(OUT_ASSETS)) {
    const relative = posix(path.relative(OUT_ASSETS, file))
    const isViteRuntime = /^runtime\.[A-Za-z0-9_-]+\.js$/.test(relative) || relative.startsWith('chunks/')
    if (isViteRuntime && !keep.has(relative)) await fs.rm(file, { force: true })
  }
  await minifyPublishedBootstrap()
  console.log(`[launch] runtime manifest points to ${runtime.entry}`)
}

function isVisual (asset) {
  return asset.kind === 'model' || asset.kind === 'image'
}

async function gzipBytes (filePath) {
  return zlib.gzipSync(await fs.readFile(filePath), { level: 9 }).byteLength
}

async function verify () {
  const [source, preparedSource, runtime] = await Promise.all([
    readJson(SOURCE_MANIFEST),
    readJson(path.join(OUT_ROOT, 'source-manifest.json')),
    readJson(RUNTIME_MANIFEST)
  ])
  const sourceContract = validateSourceManifest(source)
  validateSourceManifest(preparedSource)
  if (JSON.stringify(source) !== JSON.stringify(preparedSource)) {
    throw new Error('published launch source manifest does not match source manifest')
  }
  if (
    runtime.sourceRepository !== source.sourceRepository ||
    runtime.sourceCommit !== source.sourceCommit
  ) {
    throw new Error('runtime launch manifest source identity does not match source manifest')
  }
  assertAssetContract(sourceContract, runtime, 'runtime launch manifest')
  const failures = []
  const warnings = []
  const requireCondition = (condition, message) => {
    if (!condition) failures.push(message)
  }

  const resolvePublicUrl = (url) => path.join(ROOT, 'public', url.replace(/^\/+/, ''))
  const entryPath = resolvePublicUrl(runtime.entry)
  const entryBuffer = await fs.readFile(entryPath).catch(() => null)
  requireCondition(/^\/assets\/launch\/assets\/runtime\.[A-Za-z0-9_-]+\.js$/.test(runtime.entry), `invalid content-hashed entry: ${runtime.entry}`)
  requireCondition(Boolean(entryBuffer), `missing entry: ${runtime.entry}`)
  if (entryBuffer) {
    requireCondition(entryBuffer.byteLength === runtime.entryBytes, 'runtime entry size does not match manifest')
    requireCondition(sha256(entryBuffer) === runtime.entrySha256, 'runtime entry hash does not match manifest')
  }

  let readyVisualBytes = 0
  let visualBytes = 0
  for (const [id, asset] of Object.entries(runtime.assets || {})) {
    const filePath = resolvePublicUrl(asset.url)
    const buffer = await fs.readFile(filePath).catch(() => null)
    requireCondition(Boolean(buffer), `missing asset ${id}: ${asset.url}`)
    if (!buffer) continue
    requireCondition(buffer.byteLength === asset.bytes, `size mismatch for published asset ${id}`)
    requireCondition(sha256(buffer) === asset.sha256, `hash mismatch for published asset ${id}`)
    let mobileBuffer = null
    if (asset.mobileUrl) {
      mobileBuffer = await fs.readFile(resolvePublicUrl(asset.mobileUrl)).catch(() => null)
      requireCondition(Boolean(mobileBuffer), `missing mobile asset ${id}: ${asset.mobileUrl}`)
      if (mobileBuffer) {
        requireCondition(mobileBuffer.byteLength === asset.mobileBytes, `mobile size mismatch for ${id}`)
        requireCondition(sha256(mobileBuffer) === asset.mobileSha256, `mobile hash mismatch for ${id}`)
      }
    }
    if (asset.tier === 0 && isVisual(asset)) readyVisualBytes += buffer.byteLength
    if (isVisual(asset)) {
      // The ready budget models one high-quality device load. The total
      // publication budget includes alternate mobile derivatives as well.
      visualBytes += buffer.byteLength + (mobileBuffer?.byteLength || 0)
    }
  }
  requireCondition(
    readyVisualBytes <= LIMITS.readyVisual,
    `ready visual assets are ${readyVisualBytes} bytes; limit is ${LIMITS.readyVisual}`
  )
  requireCondition(visualBytes <= LIMITS.visual, `visual assets are ${visualBytes} bytes; limit is ${LIMITS.visual}`)

  const launchFiles = await walk(OUT_ASSETS)
  const appJs = launchFiles.filter(file => file.endsWith('.js') && !file.includes(`${path.sep}draco-r185${path.sep}`))
  const jsGzip = (await Promise.all(appJs.map(gzipBytes))).reduce((sum, bytes) => sum + bytes, 0)
  if (jsGzip > LIMITS.jsSoftGzip) warnings.push(`3D JS gzip ${jsGzip} exceeds the ${LIMITS.jsSoftGzip} soft target`)
  requireCondition(jsGzip <= LIMITS.jsHardGzip, `3D JS gzip ${jsGzip} exceeds hard limit ${LIMITS.jsHardGzip}`)

  const decoderFiles = [
    path.join(OUT_ASSETS, 'draco-r185', 'draco_wasm_wrapper.js'),
    path.join(OUT_ASSETS, 'draco-r185', 'draco_decoder.wasm')
  ]
  const decoderGzip = (await Promise.all(decoderFiles.map(gzipBytes))).reduce((sum, bytes) => sum + bytes, 0)
  requireCondition(decoderGzip <= LIMITS.decoderGzip, `Draco gzip ${decoderGzip} exceeds ${LIMITS.decoderGzip}`)
  requireCondition(jsGzip + decoderGzip <= LIMITS.jsAndDecoderGzip, '3D JS + Draco exceeds combined budget')

  const bootstrapFiles = [
    path.join(ROOT, 'public', 'js', 'genshin-launch-policies.js'),
    path.join(ROOT, 'public', 'js', 'genshin-launch.js')
  ]
  const stylesheet = path.join(ROOT, 'public', 'css', 'genshin-launch.css')
  const bootstrapGzip = (await Promise.all(
    bootstrapFiles.map(file => gzipBytes(file).catch(() => Number.POSITIVE_INFINITY))
  )).reduce((sum, bytes) => sum + bytes, 0)
  const stylesheetGzip = await gzipBytes(stylesheet).catch(() => Number.POSITIVE_INFINITY)
  requireCondition(bootstrapGzip <= LIMITS.bootstrapGzip, 'launch bootstrap is missing or exceeds 8 KiB gzip')
  requireCondition(bootstrapGzip + stylesheetGzip <= LIMITS.shellGzip, 'launch shell exceeds 60 KiB gzip')

  const allPublicFiles = await walk(path.join(ROOT, 'public'))
  requireCondition(allPublicFiles.length < LIMITS.cloudflareFiles, `public contains ${allPublicFiles.length} files`)
  for (const file of allPublicFiles) {
    const stat = await fs.stat(file)
    requireCondition(stat.size < LIMITS.cloudflareFile, `${posix(path.relative(ROOT, file))} exceeds 25 MiB`)
  }

  for (const required of [
    path.join(ROOT, 'THIRD_PARTY_NOTICES.md'),
    path.join(ROOT, 'doc', 'genshin-launch-license-matrix.md'),
    path.join(ROOT, 'public', 'credits', 'index.html'),
    path.join(OUT_ASSETS, 'THIRD_PARTY_LICENSES.txt')
  ]) {
    requireCondition(await fs.stat(required).then(() => true, () => false), `missing provenance output: ${path.relative(ROOT, required)}`)
  }

  for (const warning of warnings) console.warn(`[launch:verify] warning: ${warning}`)
  if (failures.length) {
    for (const failure of failures) console.error(`[launch:verify] ${failure}`)
    throw new Error(`launch verification failed with ${failures.length} issue(s)`)
  }
  console.log(JSON.stringify({
    readyVisualBytes,
    visualBytes,
    jsGzip,
    decoderGzip,
    shellGzip: bootstrapGzip + stylesheetGzip,
    publicFiles: allPublicFiles.length
  }, null, 2))
}

async function main () {
  const command = process.argv[2]
  if (command === 'prepare') await prepare()
  else if (command === 'finalize') await finalize()
  else if (command === 'verify') await verify()
  else throw new Error('usage: node tools/build-genshin-launch.mjs <prepare|finalize|verify>')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
