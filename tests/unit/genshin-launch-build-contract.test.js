import { describe, expect, it } from 'vitest'

import {
  assertAssetContract,
  validateSourceManifest
} from '../../tools/build-genshin-launch.mjs'

const roots = {
  vendorRoot: '/workspace/vendor',
  outputRoot: '/workspace/public/assets/launch/assets'
}

function file (overrides = {}) {
  return {
    id: 'model.door',
    relativePath: 'public/Genshin/Login/DOOR.glb',
    publish: 'models/door.glb',
    tier: 0,
    critical: true,
    ...overrides
  }
}

function manifest (...files) {
  return {
    schemaVersion: 1,
    sourceRepository: 'https://example.invalid/upstream.git',
    sourceCommit: '090cb90',
    files: files.length ? files : [file()]
  }
}

describe('Genshin launch source manifest contract', () => {
  it('derives stable required and published ID sets from validated files', () => {
    const contract = validateSourceManifest(manifest(
      file({ id: 'texture.star', relativePath: 'star.png', publish: 'textures/star.png' }),
      file(),
      file({ id: 'audio.bgm', relativePath: 'BGM.mp3', publish: 'audio/bgm.mp3', tier: 2, critical: false }),
      file({ id: 'source.license', relativePath: 'LICENSE', publish: false, critical: false })
    ), roots)

    expect(contract.requiredAssetIds).toEqual(['model.door', 'texture.star'])
    expect(contract.publishedAssetIds).toEqual(['audio.bgm', 'model.door', 'texture.star'])
    expect(contract.sourcePaths.get('model.door')).toBe('/workspace/vendor/public/Genshin/Login/DOOR.glb')
    expect(contract.publishTargets.get('texture.star')).toBe('textures/star.png')
  })

  it.each([undefined, 0, 2, '1'])('rejects unsupported schemaVersion %s', schemaVersion => {
    expect(() => validateSourceManifest({ ...manifest(), schemaVersion }, roots))
      .toThrow(/schemaVersion must be 1/)
  })

  it('rejects duplicate IDs and normalized publish targets', () => {
    expect(() => validateSourceManifest(manifest(
      file(),
      file({ relativePath: 'other.glb', publish: 'models/other.glb' })
    ), roots)).toThrow(/duplicate launch asset ID/)

    expect(() => validateSourceManifest(manifest(
      file(),
      file({ id: 'model.other', relativePath: 'other.glb', publish: 'models\/\.\/door.glb' })
    ), roots)).toThrow(/duplicate launch publish target "models\/door\.glb"/)
  })

  it.each([-1, 3, 0.5, '0', null])('rejects invalid tier %s', tier => {
    expect(() => validateSourceManifest(manifest(file({ tier })), roots))
      .toThrow(/tier must be an integer from 0 to 2/)
  })

  it.each([0, 1, 'true', null, undefined])('rejects non-boolean critical value %s', critical => {
    expect(() => validateSourceManifest(manifest(file({ critical })), roots))
      .toThrow(/critical must be a boolean/)
  })

  it.each([
    '/absolute/source.glb',
    'C:\\absolute\\source.glb',
    '..\\outside.glb',
    '../outside.glb',
    'models/../outside.glb'
  ])('rejects unsafe source path %s', relativePath => {
    expect(() => validateSourceManifest(manifest(file({ relativePath })), roots))
      .toThrow(/source path (?:must be relative|must not contain "\.\.")/)
  })

  it.each([
    '/absolute/door.glb',
    'C:\\absolute\\door.glb',
    '..\\outside.glb',
    '../outside.glb',
    'models/../outside.glb'
  ])('rejects unsafe publish path %s', publish => {
    expect(() => validateSourceManifest(manifest(file({ publish })), roots))
      .toThrow(/publish path (?:must be relative|must not contain "\.\.")/)
  })

  it('rejects invalid publish types and unpublished critical assets', () => {
    expect(() => validateSourceManifest(manifest(file({ publish: true })), roots))
      .toThrow(/publish must be a string or false/)
    expect(() => validateSourceManifest(manifest(file({ publish: false })), roots))
      .toThrow(/critical launch asset .* cannot set publish to false/)
  })
})

describe('Genshin launch required asset propagation', () => {
  const contract = {
    requiredAssetIds: ['model.door'],
    publishedAssetIds: ['audio.bgm', 'model.door']
  }
  const validCandidate = {
    requiredAssetIds: ['model.door'],
    assets: {
      'model.door': { critical: true },
      'audio.bgm': { critical: false }
    }
  }

  it('accepts an exact runtime contract', () => {
    expect(() => assertAssetContract(contract, validCandidate, 'runtime launch manifest')).not.toThrow()
  })

  it('rejects a removed required declaration or asset entry', () => {
    expect(() => assertAssetContract(contract, {
      ...validCandidate,
      requiredAssetIds: []
    }, 'runtime launch manifest')).toThrow(/required asset IDs mismatch/)

    expect(() => assertAssetContract(contract, {
      ...validCandidate,
      assets: { 'audio.bgm': { critical: false } }
    }, 'runtime launch manifest')).toThrow(/missing required asset "model\.door"/)
  })

  it('rejects critical flag drift and missing optional published entries', () => {
    expect(() => assertAssetContract(contract, {
      ...validCandidate,
      assets: {
        ...validCandidate.assets,
        'model.door': { critical: false }
      }
    }, 'runtime launch manifest')).toThrow(/must remain critical/)

    expect(() => assertAssetContract(contract, {
      ...validCandidate,
      assets: { 'model.door': { critical: true } }
    }, 'runtime launch manifest')).toThrow(/published asset IDs mismatch/)
  })
})
