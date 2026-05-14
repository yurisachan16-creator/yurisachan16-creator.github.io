import { describe, expect, it } from 'vitest'

import { normalizeArticleVersionMeta } from '../../lib/article-version'

describe('normalizeArticleVersionMeta', () => {
  it('returns null when article version metadata is missing', () => {
    expect(normalizeArticleVersionMeta({})).toBeNull()
  })

  it('normalizes current version and article history entries', () => {
    const meta = normalizeArticleVersionMeta({
      article_version: '1.2.0',
      article_history: [
        { version: '1.2.0', date: '2026-04-16', summary: '补充版本管理说明' },
        { version: '1.0.0', date: '2026-04-07', summary: '首次发布' }
      ]
    })

    expect(meta).toEqual({
      currentVersion: '1.2.0',
      history: [
        { version: '1.2.0', date: '2026-04-16', summary: '补充版本管理说明' },
        { version: '1.0.0', date: '2026-04-07', summary: '首次发布' }
      ]
    })
  })

  it('falls back to the newest valid history version when article_version is absent', () => {
    const meta = normalizeArticleVersionMeta({
      article_history: [
        { version: '2.0.0', date: '2026-04-16', summary: '结构重写' },
        { version: '1.0.0', date: '2026-04-07', summary: '首次发布' }
      ]
    })

    expect(meta).toEqual({
      currentVersion: '2.0.0',
      history: [
        { version: '2.0.0', date: '2026-04-16', summary: '结构重写' },
        { version: '1.0.0', date: '2026-04-07', summary: '首次发布' }
      ]
    })
  })

  it('filters malformed history items', () => {
    const meta = normalizeArticleVersionMeta({
      article_version: '1.0.1',
      article_history: [
        { version: '1.0.1', date: '2026-04-16', summary: '修正链接' },
        { version: '', date: '2026-04-15', summary: 'ignored' },
        { version: '1.0.0', date: '', summary: 'ignored' },
        { version: '1.0.0', date: '2026-04-07', summary: '' }
      ]
    })

    expect(meta).toEqual({
      currentVersion: '1.0.1',
      history: [
        { version: '1.0.1', date: '2026-04-16', summary: '修正链接' }
      ]
    })
  })

  it('formats ISO-like dates to YYYY-MM-DD', () => {
    const meta = normalizeArticleVersionMeta({
      article_version: '1.1.0',
      article_history: [
        {
          version: '1.1.0',
          date: '2026-04-16T00:00:00.000Z',
          summary: '同步部署信息'
        }
      ]
    })

    expect(meta).toEqual({
      currentVersion: '1.1.0',
      history: [
        { version: '1.1.0', date: '2026-04-16', summary: '同步部署信息' }
      ]
    })
  })

  it('formats date-like objects to YYYY-MM-DD', () => {
    const meta = normalizeArticleVersionMeta({
      article_version: '1.0.0',
      article_history: [
        {
          version: '1.0.0',
          date: {
            toString () {
              return '2026-04-07T00:00:00.000Z'
            }
          },
          summary: '首次发布'
        }
      ]
    })

    expect(meta).toEqual({
      currentVersion: '1.0.0',
      history: [
        { version: '1.0.0', date: '2026-04-07', summary: '首次发布' }
      ]
    })
  })
})
