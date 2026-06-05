import { describe, expect, it } from 'vitest'

function loadModule () {
  const modulePath = require.resolve('../../source/js/comment-admin.js')
  delete require.cache[modulePath]
  return require(modulePath)
}

describe('comment-admin renderers', () => {
  it('escapes comment content and nickname', () => {
    document.body.innerHTML = ''
    const { renderComment } = loadModule()

    const html = renderComment({
      id: 1,
      slug: '2026/06/03/test/',
      nickname: '<script>alert(1)</script>',
      content: '<img src=x onerror=alert(1)>',
      status: 'pending',
      created_at: '2026-06-05 12:00:00'
    })

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
  })

  it('normalizes comment slugs into same-site post links', () => {
    document.body.innerHTML = ''
    const { normalizeCommentHref, renderComment } = loadModule()

    expect(normalizeCommentHref('2026/06/03/test/')).toBe('/2026/06/03/test/')
    expect(normalizeCommentHref('/2026/06/03/test/')).toBe('/2026/06/03/test/')
    expect(normalizeCommentHref('https://evil.example/2026/06/03/test/')).toBe('/2026/06/03/test/')
    expect(normalizeCommentHref('../bad/<script>')).toBe('/bad/%3Cscript%3E')

    const html = renderComment({
      id: 2,
      slug: '2026/06/03/test/',
      nickname: '审核员',
      content: '待审核',
      status: 'pending',
      created_at: '2026-06-05 12:00:00'
    })

    expect(html).toContain('href="/2026/06/03/test/"')
  })
})
