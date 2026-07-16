import sharp from 'sharp'

export type ImageRegion = {
  x: number
  y: number
  width: number
  height: number
}

type DecodedImage = {
  data: Buffer
  width: number
  height: number
  channels: number
}

export type RgbMean = { r: number, g: number, b: number }

export type GeometryPoint = { x: number, y: number }

export type RoadGeometry = {
  viewport: { width: number, height: number }
  vanishingPoint: GeometryPoint
  normalizedVanishingPoint: GeometryPoint
  fitR2: { left: number, right: number }
  componentPixels: number
}

export type GateGeometry = {
  viewport: { width: number, height: number }
  bounds: ImageRegion
  normalizedCenter: GeometryPoint
  normalizedSize: { width: number, height: number }
  componentPixels: number
  fillRatio: number
}

export type RoadGeometryComparison = {
  detected: boolean
  passed: boolean
  threshold: number
  metrics: { vanishingPointDistance: number } | null
  reference: RoadGeometry | null
  actual: RoadGeometry | null
  diagnostics: string[]
}

export type GateGeometryComparison = {
  detected: boolean
  passed: boolean
  thresholds: { centerDistance: number, sizeDelta: number }
  metrics: {
    centerDistance: number
    widthDelta: number
    heightDelta: number
    sizeDelta: number
  } | null
  reference: GateGeometry | null
  actual: GateGeometry | null
  diagnostics: string[]
}

export type GeometryComparisonOptions = {
  maxDimension?: number
}

type GeometryDetection<T> = {
  geometry: T | null
  diagnostics: string[]
}

const DEFAULT_GEOMETRY_MAX_DIMENSION = 320
export const READY_ROAD_VANISHING_POINT_LIMIT = 0.02
export const GATE_CENTER_LIMIT = 0.01
export const GATE_SIZE_LIMIT = 0.05

async function decode (input: Buffer): Promise<DecodedImage> {
  const { data, info } = await sharp(input)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

async function decodeGeometry (
  input: Buffer,
  maxDimension = DEFAULT_GEOMETRY_MAX_DIMENSION
): Promise<DecodedImage> {
  if (!Number.isFinite(maxDimension) || maxDimension < 32) {
    throw new Error('geometry maxDimension must be at least 32')
  }
  const metadata = await sharp(input).metadata()
  if (!metadata.width || !metadata.height) throw new Error('geometry image has no dimensions')
  const scale = Math.min(1, maxDimension / Math.max(metadata.width, metadata.height))
  const width = Math.max(1, Math.round(metadata.width * scale))
  const height = Math.max(1, Math.round(metadata.height * scale))
  const { data, info } = await sharp(input)
    .removeAlpha()
    .toColourspace('srgb')
    .resize({ width, height, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

function otsuThreshold (histogram: Uint32Array, total: number): number | null {
  if (total === 0) return null
  let first = -1
  let last = -1
  let sum = 0
  for (let value = 0; value < histogram.length; value++) {
    if (histogram[value] > 0) {
      if (first < 0) first = value
      last = value
    }
    sum += value * histogram[value]
  }
  if (first === last) return first - 1

  let backgroundWeight = 0
  let backgroundSum = 0
  let bestVariance = -1
  let bestThreshold = first
  for (let value = first; value < last; value++) {
    backgroundWeight += histogram[value]
    if (backgroundWeight === 0) continue
    const foregroundWeight = total - backgroundWeight
    if (foregroundWeight === 0) break
    backgroundSum += value * histogram[value]
    const backgroundMean = backgroundSum / backgroundWeight
    const foregroundMean = (sum - backgroundSum) / foregroundWeight
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      bestThreshold = value
    }
  }
  return bestThreshold
}

function dilate (mask: Uint8Array, width: number, height: number, iterations: number): Uint8Array {
  let current = mask
  for (let iteration = 0; iteration < iterations; iteration++) {
    const next = new Uint8Array(current.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x
        if (!current[index]) continue
        for (let dy = -1; dy <= 1; dy++) {
          const targetY = y + dy
          if (targetY < 0 || targetY >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            const targetX = x + dx
            if (targetX < 0 || targetX >= width) continue
            next[targetY * width + targetX] = 1
          }
        }
      }
    }
    current = next
  }
  return current
}

function fitRobustLine (points: GeometryPoint[]): { slope: number, intercept: number, r2: number } | null {
  if (points.length < 4) return null
  const slopes: number[] = []
  for (let left = 0; left < points.length; left++) {
    for (let right = left + 1; right < points.length; right++) {
      const deltaY = points[right].y - points[left].y
      if (deltaY !== 0) slopes.push((points[right].x - points[left].x) / deltaY)
    }
  }
  if (slopes.length === 0) return null
  slopes.sort((left, right) => left - right)
  const slope = slopes[Math.floor(slopes.length / 2)]
  const intercepts = points.map(point => point.x - slope * point.y).sort((left, right) => left - right)
  const intercept = intercepts[Math.floor(intercepts.length / 2)]
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  let residual = 0
  let total = 0
  for (const point of points) {
    residual += (point.x - (slope * point.y + intercept)) ** 2
    total += (point.x - meanX) ** 2
  }
  return { slope, intercept, r2: total === 0 ? 1 : Math.max(0, 1 - residual / total) }
}

type MaskInterval = { left: number, right: number, center: number, width: number }

function maskIntervals (mask: Uint8Array, width: number, y: number): MaskInterval[] {
  const intervals: MaskInterval[] = []
  const offset = y * width
  let x = 0
  while (x < width) {
    while (x < width && !mask[offset + x]) x++
    if (x >= width) break
    const left = x
    while (x + 1 < width && mask[offset + x + 1]) x++
    const right = x
    intervals.push({ left, right, center: (left + right) / 2, width: right - left + 1 })
    x++
  }
  return intervals
}

type ActiveRun = { start: number, end: number, length: number, activeCount: number }

function longestActiveRun (active: Uint8Array, maximumGap = 2): ActiveRun | null {
  let best: ActiveRun | null = null
  let start = -1
  let lastActive = -1
  let activeCount = 0
  for (let index = 0; index <= active.length; index++) {
    const isActive = index < active.length && Boolean(active[index])
    if (isActive) {
      if (start < 0) start = index
      lastActive = index
      activeCount++
    }
    if (start >= 0 && (!isActive && index - lastActive > maximumGap || index === active.length)) {
      const run = { start, end: lastActive, length: lastActive - start + 1, activeCount }
      if (!best || run.activeCount > best.activeCount || (
        run.activeCount === best.activeCount && run.length > best.length
      )) best = run
      start = -1
      lastActive = -1
      activeCount = 0
    }
  }
  return best
}

function normalizedDistance (left: GeometryPoint, right: GeometryPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function relativeDelta (actual: number, reference: number): number {
  return reference === 0 ? Number.POSITIVE_INFINITY : Math.abs(actual - reference) / reference
}

async function detectRoadGeometry (
  input: Buffer,
  maxDimension: number
): Promise<GeometryDetection<RoadGeometry>> {
  const image = await decodeGeometry(input, maxDimension)
  const histogram = new Uint32Array(256)
  const luma = new Uint8Array(image.width * image.height)
  for (let pixel = 0, index = 0; pixel < luma.length; pixel++, index += image.channels) {
    const value = Math.max(0, Math.min(255, Math.round(
      0.2126 * image.data[index] + 0.7152 * image.data[index + 1] + 0.0722 * image.data[index + 2]
    )))
    luma[pixel] = value
    histogram[value]++
  }
  const threshold = otsuThreshold(histogram, luma.length)
  if (threshold === null) return { geometry: null, diagnostics: ['road detector found no pixels'] }

  const mask = new Uint8Array(luma.length)
  for (let pixel = 0, index = 0; pixel < luma.length; pixel++, index += image.channels) {
    const r = image.data[index]
    const g = image.data[index + 1]
    const b = image.data[index + 2]
    if (luma[pixel] > threshold && r >= b && g >= b) mask[pixel] = 1
  }
  const expandedMask = dilate(mask, image.width, image.height, 1)
  const tracedRows: Array<{ y: number, interval: MaskInterval }> = []
  let previous: MaskInterval | null = null
  let missingRows = 0
  for (let y = image.height - 1; y >= 0; y--) {
    const intervals = maskIntervals(expandedMask, image.width, y)
    const anchor = previous?.center ?? (image.width - 1) / 2
    const interval = intervals.sort((left, right) => {
      const leftDistance = anchor < left.left ? left.left - anchor : anchor > left.right ? anchor - left.right : 0
      const rightDistance = anchor < right.left ? right.left - anchor : anchor > right.right ? anchor - right.right : 0
      return leftDistance - rightDistance || right.width - left.width
    })[0]
    if (!interval) {
      missingRows++
      if (previous && missingRows > 2) break
      continue
    }
    missingRows = 0
    if (previous) {
      const widenedUpward = interval.width > previous.width * 1.4 && interval.width - previous.width > 4
      const centerJump = Math.abs(interval.center - previous.center) > Math.max(4, previous.width * 0.25)
      if (widenedUpward || centerJump) break
    }
    tracedRows.push({ y, interval })
    previous = interval
  }
  if (tracedRows.length < 8) {
    return { geometry: null, diagnostics: ['road detector could not trace the central road from the bottom edge'] }
  }

  const leftPoints: GeometryPoint[] = []
  const rightPoints: GeometryPoint[] = []
  let componentPixels = 0
  for (const { y, interval } of tracedRows) {
    if (interval.width < 4) continue
    leftPoints.push({ x: interval.left, y })
    rightPoints.push({ x: interval.right, y })
    componentPixels += interval.width
  }
  const left = fitRobustLine(leftPoints)
  const right = fitRobustLine(rightPoints)
  if (!left || !right || Math.abs(left.slope - right.slope) < 1e-6) {
    return { geometry: null, diagnostics: ['road detector could not fit two converging road edges'] }
  }
  const vanishingY = (right.intercept - left.intercept) / (left.slope - right.slope)
  const vanishingX = (left.slope * vanishingY + left.intercept + right.slope * vanishingY + right.intercept) / 2
  if (
    !Number.isFinite(vanishingX) ||
    !Number.isFinite(vanishingY) ||
    vanishingX < -image.width ||
    vanishingX > image.width * 2 ||
    vanishingY < -image.height ||
    vanishingY > image.height * 1.5
  ) {
    return { geometry: null, diagnostics: ['road detector produced an implausible vanishing point'] }
  }

  return {
    geometry: {
      viewport: { width: image.width, height: image.height },
      vanishingPoint: { x: vanishingX, y: vanishingY },
      normalizedVanishingPoint: { x: vanishingX / image.width, y: vanishingY / image.height },
      fitR2: { left: left.r2, right: right.r2 },
      componentPixels
    },
    diagnostics: []
  }
}

async function detectGateGeometry (
  input: Buffer,
  maxDimension: number
): Promise<GeometryDetection<GateGeometry>> {
  const image = await decodeGeometry(input, maxDimension)
  const luma = new Uint8Array(image.width * image.height)
  for (let pixel = 0, index = 0; pixel < luma.length; pixel++, index += image.channels) {
    luma[pixel] = Math.round(
      0.2126 * image.data[index] + 0.7152 * image.data[index + 1] + 0.0722 * image.data[index + 2]
    )
  }
  const gradient = new Uint8Array(luma.length)
  const histogram = new Uint32Array(256)
  let gradientPixels = 0
  let maximumGradient = 0
  for (let y = 1; y < image.height - 1; y++) {
    for (let x = 1; x < image.width - 1; x++) {
      const top = (y - 1) * image.width
      const middle = y * image.width
      const bottom = (y + 1) * image.width
      const horizontal = Math.abs(
        -luma[top + x - 1] + luma[top + x + 1] +
        -2 * luma[middle + x - 1] + 2 * luma[middle + x + 1] +
        -luma[bottom + x - 1] + luma[bottom + x + 1]
      )
      const value = Math.min(255, Math.round(horizontal / 4))
      gradient[middle + x] = value
      histogram[value]++
      gradientPixels++
      maximumGradient = Math.max(maximumGradient, value)
    }
  }
  if (maximumGradient === 0) {
    return { geometry: null, diagnostics: ['gate detector found no vertical edges'] }
  }
  const threshold = otsuThreshold(histogram, gradientPixels)
  if (threshold === null) return { geometry: null, diagnostics: ['gate detector found no edge pixels'] }

  const road = await detectRoadGeometry(input, maxDimension)
  const roadPoint = road.geometry?.normalizedVanishingPoint
  // The launch camera has no lateral sway: the gate is paired around the
  // viewport axis. Road geometry is used only to reject edge pairs below the
  // road terminus, because the door itself can distort the road mask.
  const anchorX = image.width / 2
  const anchorY = roadPoint && roadPoint.y >= 0 && roadPoint.y <= 1.2
    ? roadPoint.y * image.height
    : image.height * 0.72
  const edgeAt = (x: number, y: number) => {
    let value = 0
    for (let offset = -1; offset <= 1; offset++) {
      const targetX = Math.max(0, Math.min(image.width - 1, x + offset))
      value = Math.max(value, gradient[y * image.width + targetX])
    }
    return value
  }

  type VerticalEdge = { x: number, run: ActiveRun, score: number }
  const edges: VerticalEdge[] = []
  for (let x = 2; x < image.width - 2; x++) {
    const active = new Uint8Array(image.height)
    let energy = 0
    for (let y = 1; y < image.height - 1; y++) {
      const value = edgeAt(x, y)
      if (value > threshold) {
        active[y] = 1
        energy += value
      }
    }
    const run = longestActiveRun(active)
    if (!run || run.activeCount < Math.max(5, image.height * 0.035)) continue
    edges.push({ x, run, score: energy * run.activeCount / image.height })
  }

  let best: { left: VerticalEdge, right: VerticalEdge, run: ActiveRun, score: number } | null = null
  const leftEdges = edges.filter(edge => edge.x < anchorX - 2)
  const rightEdges = edges.filter(edge => edge.x > anchorX + 2)
  for (const left of leftEdges) {
    for (const right of rightEdges) {
      const separation = right.x - left.x
      if (separation < image.width * 0.07 || separation > image.width * 0.3) continue
      const active = new Uint8Array(image.height)
      let pairEnergy = 0
      for (let y = 1; y < image.height - 1; y++) {
        const leftValue = edgeAt(left.x, y)
        const rightValue = edgeAt(right.x, y)
        if (leftValue > threshold && rightValue > threshold) {
          active[y] = 1
          pairEnergy += Math.min(leftValue, rightValue)
        }
      }
      const run = longestActiveRun(active)
      if (!run || run.activeCount < Math.max(5, image.height * 0.03)) continue
      if (run.length < separation * 0.55) continue
      const centerX = (left.x + right.x) / 2
      const centerY = (run.start + run.end) / 2
      const centerPenalty = Math.abs(centerX - anchorX) / image.width
      if (centerPenalty > 0.05) continue
      const belowRoadPenalty = Math.max(0, centerY - anchorY) / image.height
      const spanWeight = 1 + separation / image.width * 3
      const score = pairEnergy * run.activeCount * spanWeight /
        (1 + centerPenalty * 30 + belowRoadPenalty * 12)
      if (!best || score > best.score) best = { left, right, run, score }
    }
  }
  if (!best) {
    return { geometry: null, diagnostics: ['gate detector could not pair two persistent vertical door edges'] }
  }

  const width = best.right.x - best.left.x + 1
  const verticalStart = Math.min(best.left.run.start, best.right.run.start)
  const verticalEnd = Math.max(best.left.run.end, best.right.run.end)
  const height = verticalEnd - verticalStart + 1
  const bounds = { x: best.left.x, y: verticalStart, width, height }

  return {
    geometry: {
      viewport: { width: image.width, height: image.height },
      bounds,
      normalizedCenter: {
        x: (bounds.x + width / 2) / image.width,
        y: (bounds.y + height / 2) / image.height
      },
      normalizedSize: { width: width / image.width, height: height / image.height },
      componentPixels: best.left.run.activeCount + best.right.run.activeCount,
      fillRatio: (best.left.run.activeCount + best.right.run.activeCount) / (height * 2)
    },
    diagnostics: []
  }
}

function normalizedRegion (image: DecodedImage, region?: ImageRegion): ImageRegion {
  if (!region) return { x: 0, y: 0, width: image.width, height: image.height }
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(region.x)))
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(region.y)))
  return {
    x,
    y,
    width: Math.max(1, Math.min(image.width - x, Math.floor(region.width))),
    height: Math.max(1, Math.min(image.height - y, Math.floor(region.height)))
  }
}

export async function rgbMean (input: Buffer, region?: ImageRegion): Promise<RgbMean> {
  const image = await decode(input)
  const bounds = normalizedRegion(image, region)
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      const index = (y * image.width + x) * image.channels
      r += image.data[index]
      g += image.data[index + 1]
      b += image.data[index + 2]
      count++
    }
  }
  return { r: r / count, g: g / count, b: b / count }
}

export function maxRgbMeanDelta (left: RgbMean, right: RgbMean): number {
  return Math.max(
    Math.abs(left.r - right.r),
    Math.abs(left.g - right.g),
    Math.abs(left.b - right.b)
  )
}

export async function whitePixelRatio (input: Buffer, minimum = 248): Promise<number> {
  const image = await decode(input)
  let white = 0
  const pixels = image.width * image.height
  for (let index = 0; index < image.data.length; index += image.channels) {
    if (
      image.data[index] >= minimum &&
      image.data[index + 1] >= minimum &&
      image.data[index + 2] >= minimum
    ) white++
  }
  return white / pixels
}

export async function compareVisuals (
  actualInput: Buffer,
  expectedInput: Buffer,
  channelThreshold = 0.12
): Promise<{ ssim: number, diffPixelRatio: number }> {
  const [actual, expected] = await Promise.all([decode(actualInput), decode(expectedInput)])
  if (
    actual.width !== expected.width ||
    actual.height !== expected.height ||
    actual.channels !== expected.channels
  ) {
    throw new Error(
      `visual dimensions differ: ${actual.width}x${actual.height}x${actual.channels} vs ` +
      `${expected.width}x${expected.height}x${expected.channels}`
    )
  }

  const pixels = actual.width * actual.height
  const threshold = channelThreshold * 255
  let different = 0
  let actualMean = 0
  let expectedMean = 0
  const actualLuma = new Float64Array(pixels)
  const expectedLuma = new Float64Array(pixels)

  for (let pixel = 0, index = 0; pixel < pixels; pixel++, index += actual.channels) {
    const ar = actual.data[index]
    const ag = actual.data[index + 1]
    const ab = actual.data[index + 2]
    const er = expected.data[index]
    const eg = expected.data[index + 1]
    const eb = expected.data[index + 2]
    if (Math.max(Math.abs(ar - er), Math.abs(ag - eg), Math.abs(ab - eb)) > threshold) different++
    const a = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab
    const e = 0.2126 * er + 0.7152 * eg + 0.0722 * eb
    actualLuma[pixel] = a
    expectedLuma[pixel] = e
    actualMean += a
    expectedMean += e
  }
  actualMean /= pixels
  expectedMean /= pixels

  let actualVariance = 0
  let expectedVariance = 0
  let covariance = 0
  for (let pixel = 0; pixel < pixels; pixel++) {
    const actualDelta = actualLuma[pixel] - actualMean
    const expectedDelta = expectedLuma[pixel] - expectedMean
    actualVariance += actualDelta * actualDelta
    expectedVariance += expectedDelta * expectedDelta
    covariance += actualDelta * expectedDelta
  }
  const divisor = Math.max(1, pixels - 1)
  actualVariance /= divisor
  expectedVariance /= divisor
  covariance /= divisor

  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  const ssim = (
    (2 * actualMean * expectedMean + c1) * (2 * covariance + c2)
  ) / (
    (actualMean ** 2 + expectedMean ** 2 + c1) *
    (actualVariance + expectedVariance + c2)
  )

  return { ssim, diffPixelRatio: different / pixels }
}

/**
 * Compares the ready road's perspective without assuming an expected screen
 * coordinate. Both images go through the same adaptive luminance/warmth mask,
 * connected-component selection and edge fit; only their normalized result is
 * compared against the V2 acceptance limit.
 */
export async function compareReadyRoadGeometry (
  actualInput: Buffer,
  referenceInput: Buffer,
  options: GeometryComparisonOptions & { vanishingPointLimit?: number } = {}
): Promise<RoadGeometryComparison> {
  const maxDimension = options.maxDimension ?? DEFAULT_GEOMETRY_MAX_DIMENSION
  const threshold = options.vanishingPointLimit ?? READY_ROAD_VANISHING_POINT_LIMIT
  const [actualDetection, referenceDetection] = await Promise.all([
    detectRoadGeometry(actualInput, maxDimension),
    detectRoadGeometry(referenceInput, maxDimension)
  ])
  const diagnostics = [
    ...referenceDetection.diagnostics.map(message => `reference: ${message}`),
    ...actualDetection.diagnostics.map(message => `actual: ${message}`)
  ]
  const actual = actualDetection.geometry
  const reference = referenceDetection.geometry
  if (!actual || !reference) {
    return { detected: false, passed: false, threshold, metrics: null, reference, actual, diagnostics }
  }

  const vanishingPointDistance = normalizedDistance(
    actual.normalizedVanishingPoint,
    reference.normalizedVanishingPoint
  )
  const passed = vanishingPointDistance <= threshold
  diagnostics.push(
    `road vanishing-point distance=${vanishingPointDistance.toFixed(5)} ` +
    `(limit=${threshold.toFixed(5)}; reference=${reference.normalizedVanishingPoint.x.toFixed(4)},` +
    `${reference.normalizedVanishingPoint.y.toFixed(4)}; actual=${actual.normalizedVanishingPoint.x.toFixed(4)},` +
    `${actual.normalizedVanishingPoint.y.toFixed(4)})`
  )
  return {
    detected: true,
    passed,
    threshold,
    metrics: { vanishingPointDistance },
    reference,
    actual,
    diagnostics
  }
}

/**
 * Pairs persistent vertical door edges around the fixed camera axis in each
 * frame. Center error uses normalized viewport distance; size error is the
 * larger relative width/height delta.
 */
export async function compareGateGeometry (
  actualInput: Buffer,
  referenceInput: Buffer,
  options: GeometryComparisonOptions & { centerLimit?: number, sizeLimit?: number } = {}
): Promise<GateGeometryComparison> {
  const maxDimension = options.maxDimension ?? DEFAULT_GEOMETRY_MAX_DIMENSION
  const thresholds = {
    centerDistance: options.centerLimit ?? GATE_CENTER_LIMIT,
    sizeDelta: options.sizeLimit ?? GATE_SIZE_LIMIT
  }
  const [actualDetection, referenceDetection] = await Promise.all([
    detectGateGeometry(actualInput, maxDimension),
    detectGateGeometry(referenceInput, maxDimension)
  ])
  const diagnostics = [
    ...referenceDetection.diagnostics.map(message => `reference: ${message}`),
    ...actualDetection.diagnostics.map(message => `actual: ${message}`)
  ]
  const actual = actualDetection.geometry
  const reference = referenceDetection.geometry
  if (!actual || !reference) {
    return { detected: false, passed: false, thresholds, metrics: null, reference, actual, diagnostics }
  }

  const centerDistance = normalizedDistance(actual.normalizedCenter, reference.normalizedCenter)
  const widthDelta = relativeDelta(actual.normalizedSize.width, reference.normalizedSize.width)
  const heightDelta = relativeDelta(actual.normalizedSize.height, reference.normalizedSize.height)
  const sizeDelta = Math.max(widthDelta, heightDelta)
  const passed = centerDistance <= thresholds.centerDistance && sizeDelta <= thresholds.sizeDelta
  diagnostics.push(
    `gate center distance=${centerDistance.toFixed(5)} (limit=${thresholds.centerDistance.toFixed(5)}); ` +
    `size delta=${sizeDelta.toFixed(5)} (limit=${thresholds.sizeDelta.toFixed(5)}; ` +
    `width=${widthDelta.toFixed(5)}, height=${heightDelta.toFixed(5)})`
  )
  return {
    detected: true,
    passed,
    thresholds,
    metrics: { centerDistance, widthDelta, heightDelta, sizeDelta },
    reference,
    actual,
    diagnostics
  }
}
