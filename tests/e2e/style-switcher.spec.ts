import { test, expect } from '@playwright/test'

test.describe('风格切换器 E2E 测试', () => {
  async function toggleStyle (page) {
    await page.locator('#style-switcher-btn').dispatchEvent('click')
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => localStorage.removeItem('site_style_v1'))
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#style-switcher-btn')
  })

  test('rightside 风格按钮可见', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)

    const btn = page.locator('#style-switcher-btn')
    await expect(btn).toBeVisible()
    await expect(btn.locator('i.fas.fa-palette')).toBeVisible()
  })

  test('点击按钮切换 html[data-style]', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)

    await expect(page.locator('html')).toHaveAttribute('data-style', 'pixel')
    await toggleStyle(page)
    await expect(page.locator('html')).toHaveAttribute('data-style', 'vereis')
    await expect(page.locator('#style-switcher-btn')).toHaveAttribute('aria-pressed', 'true')
  })

  test('刷新后保留已选择的风格', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)
    await toggleStyle(page)
    await expect(page.locator('html')).toHaveAttribute('data-style', 'vereis')

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#style-switcher-btn')

    await expect(page.locator('html')).toHaveAttribute('data-style', 'vereis')
    await expect(page.locator('#style-switcher-btn')).toHaveAttribute('aria-pressed', 'true')
  })

  test('PJAX 导航后按钮和风格状态保留', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)
    await toggleStyle(page)
    await expect(page.locator('html')).toHaveAttribute('data-style', 'vereis')

    await page.evaluate(() => {
      window.history.pushState({}, '', '/about/')
      document.dispatchEvent(new Event('pjax:complete'))
    })
    await page.waitForSelector('#style-switcher-btn')

    await expect(page.locator('html')).toHaveAttribute('data-style', 'vereis')
    await expect(page.locator('#style-switcher-btn')).toBeVisible()
  })

  test('移动端可以切换风格', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#style-switcher-btn')

    await page.evaluate(() => window.scrollTo(0, 300))
    await page.waitForTimeout(500)
    await toggleStyle(page)

    await expect(page.locator('html')).toHaveAttribute('data-style', 'vereis')
  })
})
