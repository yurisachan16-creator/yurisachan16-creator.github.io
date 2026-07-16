import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'launch/asset-source-manifest.json'), 'utf8'))
const visualFiles = manifest.files.filter(file =>
  file.publish !== false && /\.(?:glb|gltf|png|jpe?g|webp|avif)$/i.test(file.relativePath)
)

describe('Genshin reference-profile assets', () => {
  it('pins the complete critical visual contract', () => {
    expect(manifest.files.filter(file => file.critical === true).map(file => file.id).sort()).toEqual([
      'model.bigCloud',
      'model.bridge01',
      'model.bridge02',
      'model.bridge03',
      'model.bridge04',
      'model.column01',
      'model.column02',
      'model.column03',
      'model.column04',
      'model.door',
      'model.light',
      'model.road',
      'model.whitePlane',
      'texture.cloud',
      'texture.cloud0',
      'texture.cloud1',
      'texture.light',
      'texture.star'
    ])
  })

  it('locks every visual-essential asset to the pinned upstream commit and ready tier', () => {
    expect(manifest.sourceCommit).toBe('090cb905a53a078fb192fc7e3da2a7a679d35ff4')
    expect(visualFiles.length).toBeGreaterThan(0)
    expect(visualFiles.every(file => file.tier === 0)).toBe(true)
    expect(visualFiles.every(file => file.critical === true)).toBe(true)
  })

  it('keeps the original PNG masks for the high-fidelity profile', () => {
    const masks = visualFiles.filter(file => file.relativePath.endsWith('.png'))
    expect(masks.map(file => file.id)).toEqual([
      'texture.cloud',
      'texture.cloud0',
      'texture.cloud1',
      'texture.light',
      'texture.star'
    ])
    expect(masks.every(file => String(file.publish).endsWith('.png'))).toBe(true)
  })

  it('fits the complete ready visual set within 3.5 MiB', () => {
    const readyBytes = visualFiles.reduce((sum, file) => sum + file.bytes, 0)
    expect(readyBytes).toBeLessThanOrEqual(3.5 * 1024 * 1024)
  })

  it('keeps audio optional and outside the visual-ready gate', () => {
    const audio = manifest.files.filter(file => file.id.startsWith('audio.'))
    expect(audio.length).toBeGreaterThan(0)
    expect(audio.every(file => file.critical === false)).toBe(true)
    expect(audio.every(file => file.tier > 0)).toBe(true)
  })
})
