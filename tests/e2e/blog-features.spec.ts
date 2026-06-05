import { test, expect } from '@playwright/test'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Anon-Id'
}

async function blockThirdPartyResources (page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net|challenges\.cloudflare\.com|cubism\.live2d\.com)\/.*/, async (route) => {
    await route.abort()
  })
  await page.route('https://api.i-meto.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]'
    })
  })
}

async function mockDynamicApi (page) {
  await page.route('https://api.yurisa.top/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: corsHeaders,
        body: ''
      })
      return
    }
    if (url.pathname.endsWith('/metrics')) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({ views: 10, likes: 2, comments: 1, likedByMe: false })
      })
      return
    }
    if (url.pathname.endsWith('/view')) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({ views: 11 })
      })
      return
    }
    if (url.pathname.endsWith('/comments') && route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({ comments: [], nextCursor: null })
      })
      return
    }
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    })
  })
}

test.describe('博客功能页 E2E 测试', () => {
  test.describe.configure({ mode: 'serial' })

  test('阅读路线页渲染专题路线和文章步骤', async ({ page }) => {
    await blockThirdPartyResources(page)
    await page.goto('/reading/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.reading-route-card')

    await expect(page.locator('.reading-route-card').first()).toBeVisible()
    await expect(page.getByText('Claude Code 源码阅读路线')).toBeVisible()
    await expect(page.locator('.reading-route-step').first()).toBeVisible()
  })

  test('最近更新页渲染文章版本记录并支持分类筛选', async ({ page }) => {
    await blockThirdPartyResources(page)
    await page.goto('/updates/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.updates-timeline-item')

    await expect(page.locator('.updates-timeline-item').first()).toBeVisible()
    await expect(page.getByText(/首次发布|加深/).first()).toBeVisible()

    const musicFilter = page.locator('[data-update-filter="音乐札记"]')
    if (await musicFilter.count()) {
      await musicFilter.dispatchEvent('click')
      await expect(page.locator('.updates-timeline-item').first()).toContainText('音乐札记')
    }
  })

  test('文章页支持加入稍后读并在抽屉里展示', async ({ page }) => {
    await blockThirdPartyResources(page)
    await mockDynamicApi(page)
    await page.goto('/2026/04/02/claude-code-architecture/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#reading-memory-inline')

    await page.locator('[data-reading-save-current]').dispatchEvent('click')
    await expect(page.locator('[data-reading-save-current]')).toHaveText('已加入稍后读')

    await page.locator('#reading-memory-btn').dispatchEvent('click')
    await expect(page.locator('#reading-memory-drawer')).toBeVisible()
    await expect(page.locator('.reading-memory-item').first()).toContainText('Claude Code')
  })

  test('评论管理页使用管理员 token 读取待审核评论', async ({ page }) => {
    await blockThirdPartyResources(page)
    await page.route('https://api.yurisa.top/api/v1/admin/comments**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: corsHeaders,
          body: ''
        })
        return
      }
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: 'application/json',
        body: JSON.stringify({
          comments: [
            {
              id: 7,
              slug: '2026/06/03/test/',
              parent_id: null,
              nickname: '<Admin Test>',
              content: '<img src=x onerror=alert(1)> 待审核评论',
              status: 'pending',
              created_at: '2026-06-05 12:00:00',
              updated_at: '2026-06-05 12:00:00'
            }
          ],
          nextCursor: null
        })
      })
    })

    await page.goto('/admin/comments/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.comment-admin-panel')
    await page.locator('#comment-admin-token').fill('test-admin-token')
    await page.locator('[data-comment-admin-load]').dispatchEvent('click')

    await expect(page.locator('.comment-admin-card')).toContainText('待审核评论')
    await expect(page.locator('.comment-admin-card img')).toHaveCount(0)
    await expect(page.locator('.comment-admin-card a')).toHaveAttribute('href', /\/2026\/06\/03\/test\/$/)
    await expect(page.locator('[data-comment-action="approve"]')).toBeVisible()
  })
})
