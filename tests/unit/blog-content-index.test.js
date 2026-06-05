import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const data = JSON.parse(readFileSync(path.join(process.cwd(), 'source/data/blog-content-index.json'), 'utf8'))

describe('blog-content-index', () => {
  it('contains the expected reading routes with entries', () => {
    const routes = Object.fromEntries(data.routes.map((route) => [route.id, route]))

    expect(routes['claude-code'].entries.length).toBeGreaterThanOrEqual(3)
    expect(routes['future-master'].entries.length).toBeGreaterThanOrEqual(4)
    expect(routes['blog-building'].entries.length).toBeGreaterThanOrEqual(1)
    expect(routes['ai-tools'].entries.length).toBeGreaterThanOrEqual(1)
    expect(routes['game-design'].entries.length).toBeGreaterThanOrEqual(1)

    expect(routes['future-master'].entries.map((entry) => entry.url)).toContain('/music/luo-dayou-future-master/00-guide/')
  })

  it('keeps update entries complete and sorted newest first', () => {
    expect(data.updates.length).toBeGreaterThan(0)
    data.updates.forEach((item) => {
      expect(item.title).toBeTruthy()
      expect(item.url).toMatch(/^\//)
      expect(item.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(item.summary).toBeTruthy()
    })

    const dates = data.updates.map((item) => item.date)
    const sorted = [...dates].sort().reverse()
    expect(dates).toEqual(sorted)
  })
})
