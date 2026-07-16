import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  path.join(process.cwd(), 'tools/capture-genshin-reference.mjs'),
  'utf8'
)

describe('Genshin upstream reference capture timing contract', () => {
  it('advances RAF and animation callbacks in chronological steps no larger than 16ms', () => {
    expect(source).toContain('const MAX_FRAME_STEP_MS = 16')
    expect(source).not.toMatch(/page\.clock\.fastForward\s*\(/)
    expect(source).toContain('await page.clock.pauseAt(new Date(REFERENCE_EPOCH))')
    expect(source).toContain('const stepMs = Math.min(MAX_FRAME_STEP_MS, remainingMs)')
    expect(source).toContain('await page.clock.runFor(stepMs)')
    expect(source).toContain('remainingMs -= stepMs')
    expect(source).toContain('const advanceUntil = (predicate, maximumMs, label)')
    expect(source).toContain('if (await page.evaluate(predicate)) return elapsedMs')
    expect(source).toContain("'upstream road seam / gate-forming event'")
    expect(source).not.toContain('let seamElapsed = 2_414')
    const runForArguments = [...source.matchAll(/page\.clock\.runFor\(([^)]+)\)/g)]
      .map(match => match[1])
    expect(new Set(runForArguments)).toEqual(new Set(['READY_RENDER_MS', 'stepMs']))
    expect(source).toMatch(
      /const seamElapsed = await advanceUntil\([\s\S]*?captureAfter\('road-rise-0600', 600, seamElapsed \+ 600\)/
    )
  })

  it('initializes ready with two frames and reserves four native-resolution frames per later milestone', () => {
    expect(source).toContain('const EVIDENCE_FRAME_MS = 16')
    expect(source).toContain('const READY_FRAME_COUNT = 2')
    expect(source).toContain('const READY_RENDER_MS = EVIDENCE_FRAME_MS * READY_FRAME_COUNT')
    expect(source).toContain('const EVIDENCE_FRAME_COUNT = 4')
    expect(source).toContain('const DOOR_FORMATION_SEMANTIC_MS = 1_458')
    expect(source).toContain('const DOOR_FORMATION_RENDER_MS = 1_472')
    expect(source).toContain('advanceMs - EVIDENCE_RENDER_MS')
    expect(source).toContain('await setViewport(VIEWPORT)')
    expect(source).not.toContain('__genshinReferenceSetDrawEnabled')
    expect(source).not.toContain('patchDrawMethod')
    expect(source).toContain('const { PostprocessingPlugin, RenderPlugin }')
    expect(source).toContain('__genshinReferenceSetRenderEnabled')
    expect(source).toContain('await advanceClock(EVIDENCE_RENDER_MS, `${name} full-resolution evidence frames`)')
    expect(source).toMatch(
      /advanceClock\(EVIDENCE_RENDER_MS,[\s\S]*?await capture\(name, elapsedMs, renderedElapsedMs\)[\s\S]*?setViewport\(SIMULATION_VIEWPORT\)/
    )
    expect(source).toContain("context?.finish?.()")
    expect(source).toContain('simulationDrawCallsSuppressed: false')
    expect(source).toContain('simulationRenderPluginsPaused: true')
  })

  it('retains the eight semantic frames and atomic directory publication', () => {
    for (const name of [
      'ready',
      'road-rise-0600',
      'door-formed-1458',
      'road-settled-2000',
      'gate-stable-5000',
      'enter-0500',
      'enter-0700',
      'enter-0840'
    ]) expect(source).toContain(`'${name}'`)
    expect(source).toContain('await fs.rm(captureViteConfig, { force: true })')
    expect(source.indexOf('await fs.rm(captureViteConfig, { force: true })'))
      .toBeLessThan(source.indexOf('await publishCaptureDirectory(captureDir, outputDir)'))
    expect(source).toContain('await publishCaptureDirectory(captureDir, outputDir)')
    expect(source).toMatch(/await fs\.rename\(stagingDir, destinationDir\)/)
  })

  it('uses stable page evaluation for canvas access and validates every resize', () => {
    expect(source).not.toMatch(/locator\(['"]canvas\.webgl-canvas['"]\)\.evaluate/)
    expect(source).toContain('page.setDefaultTimeout(300_000)')
    expect(source).toContain('upstream canvas disappeared after resize')
    expect(source).toContain('upstream canvas disappeared before evidence capture')
    expect(source).toContain('`${name} CDP screenshot`')
    expect(source).toContain("withHostTimeout(page.evaluate(() => {")
    expect(source).toContain('genshin-reference-production-react-semantics')
    expect(source).toContain('reactStrictModeDevelopmentDoubleMountDisabled: true')
    expect(source).toContain('__genshinReferenceStateGame = this')
    expect(source).toContain('state._jump()')
    expect(source).toContain('enterTransitionDispatch:')
    expect(source).toContain('__genshinReferenceRoad = this')
    expect(source).toContain('activeRoadInitialState')
    expect(source).toContain('waitForSceneGraphQuiescence')
    expect(source).toContain('sceneGraphQuiescence: sceneGraphState')
  })
})
