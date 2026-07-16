import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  compareGateGeometry,
  compareReadyRoadGeometry,
  compareVisuals,
  maxRgbMeanDelta,
  rgbMean,
  whitePixelRatio
} from '../helpers/launch-visual-metrics'

async function solid (rgb: { r: number, g: number, b: number }, width = 4, height = 4) {
  return sharp({ create: { width, height, channels: 3, background: rgb } }).png().toBuffer()
}

type SyntheticRoad = {
  vanishingX?: number
  vanishingY?: number
  bottomCenterX?: number
  bottomHalfWidth?: number
  gate?: { centerX: number, centerY: number, width: number, height: number }
}

async function syntheticRoad ({
  vanishingX = 120,
  vanishingY = 44,
  bottomCenterX = 120,
  bottomHalfWidth = 102,
  gate
}: SyntheticRoad = {}): Promise<Buffer> {
  const width = 240
  const height = 135
  const background = { r: 18, g: 91, b: 220 }
  const road = { r: 242, g: 226, b: 188 }
  const gateColour = { r: 255, g: 252, b: 246 }
  const data = Buffer.alloc(width * height * 3)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let colour = background
      if (y >= vanishingY) {
        const progress = (y - vanishingY) / Math.max(1, height - 1 - vanishingY)
        const center = vanishingX + (bottomCenterX - vanishingX) * progress
        const halfWidth = 2 + (bottomHalfWidth - 2) * progress
        if (x >= center - halfWidth && x <= center + halfWidth) colour = road
      }
      if (gate) {
        const left = Math.round(gate.centerX - gate.width / 2)
        const right = Math.round(gate.centerX + gate.width / 2)
        const top = Math.round(gate.centerY - gate.height / 2)
        const bottom = Math.round(gate.centerY + gate.height / 2)
        const thickness = 4
        const insideBounds = x >= left && x <= right && y >= top && y <= bottom
        const onFrame = insideBounds && (
          x < left + thickness || x > right - thickness || y < top + thickness || y > bottom - thickness
        )
        if (onFrame) colour = gateColour
      }
      const index = (y * width + x) * 3
      data[index] = colour.r
      data[index + 1] = colour.g
      data[index + 2] = colour.b
    }
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

describe('launch visual metrics', () => {
  it('reports identical images as perfect matches', async () => {
    const image = await solid({ r: 24, g: 80, b: 160 })
    await expect(compareVisuals(image, image)).resolves.toEqual({
      ssim: 1,
      diffPixelRatio: 0
    })
  })

  it('measures channel means and their largest delta', async () => {
    const left = await rgbMean(await solid({ r: 10, g: 20, b: 30 }))
    const right = await rgbMean(await solid({ r: 18, g: 23, b: 28 }))
    expect(left).toEqual({ r: 10, g: 20, b: 30 })
    expect(maxRgbMeanDelta(left, right)).toBe(8)
  })

  it('counts only pixels whose every channel reaches the white floor', async () => {
    const raw = Buffer.from([
      248, 248, 248,
      255, 247, 255,
      255, 255, 255,
      247, 247, 247
    ])
    const image = await sharp(raw, { raw: { width: 2, height: 2, channels: 3 } }).png().toBuffer()
    await expect(whitePixelRatio(image)).resolves.toBe(0.5)
  })

  it('rejects comparisons with different dimensions', async () => {
    const left = await solid({ r: 0, g: 0, b: 0 }, 2, 2)
    const right = await solid({ r: 0, g: 0, b: 0 }, 3, 2)
    await expect(compareVisuals(left, right)).rejects.toThrow(/dimensions differ/)
  })
})

describe('launch reference geometry metrics', () => {
  it('accepts a reproducible ready-road vanishing point within 2% of the viewport', async () => {
    const reference = await syntheticRoad()
    const actual = await syntheticRoad({ vanishingX: 121 })
    const comparison = await compareReadyRoadGeometry(actual, reference)

    expect(comparison.detected).toBe(true)
    expect(comparison.passed).toBe(true)
    expect(comparison.threshold).toBe(0.02)
    expect(comparison.metrics?.vanishingPointDistance).toBeLessThan(0.02)
    expect(comparison.diagnostics.at(-1)).toMatch(/road vanishing-point distance=/)
  })

  it('rejects a ready-road vanishing-point offset beyond 2%', async () => {
    const reference = await syntheticRoad()
    const actual = await syntheticRoad({ vanishingX: 130 })
    const comparison = await compareReadyRoadGeometry(actual, reference)

    expect(comparison.detected).toBe(true)
    expect(comparison.passed).toBe(false)
    expect(comparison.metrics?.vanishingPointDistance).toBeGreaterThan(0.02)
  })

  it('accepts gate center and size drift within the 1% / 5% limits', async () => {
    const reference = await syntheticRoad({
      gate: { centerX: 120, centerY: 59, width: 58, height: 78 }
    })
    const actual = await syntheticRoad({
      gate: { centerX: 121, centerY: 59, width: 60, height: 80 }
    })
    const comparison = await compareGateGeometry(actual, reference)

    expect(comparison.detected).toBe(true)
    expect(comparison.passed).toBe(true)
    expect(comparison.thresholds).toEqual({ centerDistance: 0.01, sizeDelta: 0.05 })
    expect(comparison.metrics?.centerDistance).toBeLessThan(0.01)
    expect(comparison.metrics?.sizeDelta).toBeLessThan(0.05)
    expect(comparison.diagnostics.at(-1)).toMatch(/gate center distance=/)
  })

  it('rejects a gate center offset beyond 1%', async () => {
    const reference = await syntheticRoad({
      gate: { centerX: 120, centerY: 59, width: 58, height: 78 }
    })
    const actual = await syntheticRoad({
      gate: { centerX: 126, centerY: 59, width: 58, height: 78 }
    })
    const comparison = await compareGateGeometry(actual, reference)

    expect(comparison.detected).toBe(true)
    expect(comparison.passed).toBe(false)
    expect(comparison.metrics?.centerDistance).toBeGreaterThan(0.01)
  })

  it('rejects a gate scale change beyond 5%', async () => {
    const reference = await syntheticRoad({
      gate: { centerX: 120, centerY: 59, width: 58, height: 78 }
    })
    const actual = await syntheticRoad({
      gate: { centerX: 120, centerY: 59, width: 74, height: 96 }
    })
    const comparison = await compareGateGeometry(actual, reference)

    expect(comparison.detected).toBe(true)
    expect(comparison.passed).toBe(false)
    expect(comparison.metrics?.sizeDelta).toBeGreaterThan(0.05)
  })

  it('returns actionable diagnostics instead of fabricated geometry when detection fails', async () => {
    const blue = await solid({ r: 18, g: 91, b: 220 }, 240, 135)
    const roadReference = await syntheticRoad()
    const gateReference = await syntheticRoad({
      gate: { centerX: 120, centerY: 59, width: 58, height: 78 }
    })
    const [road, gate] = await Promise.all([
      compareReadyRoadGeometry(blue, roadReference),
      compareGateGeometry(blue, gateReference)
    ])

    expect(road).toMatchObject({ detected: false, passed: false, metrics: null, actual: null })
    expect(road.diagnostics.join('\n')).toMatch(/actual: road detector/)
    expect(gate).toMatchObject({ detected: false, passed: false, metrics: null, actual: null })
    expect(gate.diagnostics.join('\n')).toMatch(/actual: gate detector/)
  })
})
