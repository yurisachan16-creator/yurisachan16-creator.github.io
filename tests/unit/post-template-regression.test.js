import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const Hexo = require('hexo')

async function streamToString (stream) {
  let html = ''

  for await (const chunk of stream) {
    html += chunk.toString()
  }

  return html
}

describe('post template emergency rollback', () => {
  let hexo

  beforeAll(async () => {
    hexo = new Hexo(process.cwd(), { silent: true })
    await hexo.init()
    await hexo.call('generate')
  }, 30000)

  afterAll(async () => {
    if (hexo) await hexo.exit()
  })

  it('does not render the article version section on post pages', async () => {
    const html = await streamToString(
      hexo.route.get('2025/11/25/my-first-blog/index.html')
    )

    expect(html).not.toContain('<section class="article-version">')
    expect(html).not.toContain('class="article-version__title">更新记录')
  })
})
