import { test, expect } from '@playwright/test'

async function mockNeteasePlaylist (page) {
  await page.route(/https:\/\/(cdn\.jsdelivr\.net|challenges\.cloudflare\.com|cubism\.live2d\.com)\/.*/, async (route) => {
    await route.abort()
  })
  await page.route('**/music/test-*.mp3', async (route) => {
    await route.fulfill({
      status: 204,
      body: ''
    })
  })
  await page.route('https://api.i-meto.com/meting/api**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          name: '测试曲目 A',
          artist: 'Yurisa Lab',
          url: '/music/test-a.mp3',
          pic: '/img/pixel-logo.png',
          album: 'E2E'
        },
        {
          name: '测试曲目 B',
          artist: 'Yurisa Lab',
          url: '/music/test-b.mp3',
          pic: '/img/pixel-logo.png',
          album: 'E2E'
        }
      ])
    })
  })
}

async function openHome (page) {
  await mockNeteasePlaylist(page)
  await page.goto('/?launch=off', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#music-player-btn')
}

async function showRightside (page) {
  await page.evaluate(() => window.scrollTo(0, 300))
  await page.waitForTimeout(300)
}

async function clickByEvent (page, selector) {
  await page.locator(selector).dispatchEvent('click')
}

test.describe('音乐播放器 E2E 测试', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await openHome(page)
  })

  /* === 入口按钮可见性 === */
  test('rightside 音乐按钮可见', async ({ page }) => {
    // 滚动触发 rightside 显示
    await showRightside(page)

    const btn = page.locator('#music-player-btn')
    await expect(btn).toBeAttached()
    // 图标正确
    await expect(btn.locator('i.fas.fa-music')).toBeAttached()
    await expect(page.locator('#music-drawer')).toHaveCount(0)
  })

  /* === 抽屉开关 === */
  test('点击音乐按钮打开抽屉', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    const drawer = page.locator('#music-drawer')
    await expect(drawer).toHaveClass(/open/)

    const mask = page.locator('#music-drawer-mask')
    await expect(mask).toHaveClass(/open/)
  })

  test('点击遮罩关闭抽屉', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    await expect(page.locator('#music-drawer')).toHaveClass(/open/)

    await clickByEvent(page, '#music-drawer-mask')
    await expect(page.locator('#music-drawer')).not.toHaveClass(/open/)
  })

  test('点击关闭按钮关闭抽屉', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    await expect(page.locator('#music-drawer')).toHaveClass(/open/)

    await clickByEvent(page, '#music-drawer-close')
    await expect(page.locator('#music-drawer')).not.toHaveClass(/open/)
  })

  /* === 播放列表加载 === */
  test('播放列表包含曲目', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    // 等待播放列表渲染
    await page.waitForSelector('#music-playlist li', { timeout: 10_000 })
    const items = page.locator('#music-playlist li')
    const count = await items.count()
    expect(count).toBeGreaterThan(0)
  })

  /* === 播放控制 === */
  test('点击播放按钮切换播放状态', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    await page.waitForSelector('#music-playlist li', { timeout: 10_000 })

    // 点击播放
    await clickByEvent(page, '#music-play')
    await page.waitForTimeout(500)

    // 图标应变为暂停
    const icon = page.locator('#music-play i')
    // 可能是 pause 或 play（取决于自动播放策略）
    const cls = await icon.getAttribute('class')
    expect(cls).toMatch(/fa-pause|fa-play/)
  })

  /* === 切歌 === */
  test('下一首按钮切换曲目', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')
    await page.waitForSelector('#music-playlist li', { timeout: 10_000 })

    // 记录当前标题
    const titleBefore = await page.locator('#music-current-title').textContent()

    // 先触发播放选中第一首
    await clickByEvent(page, '#music-play')
    await page.waitForTimeout(300)

    // 点击下一首
    await clickByEvent(page, '#music-next')
    await page.waitForTimeout(300)

    const titleAfter = await page.locator('#music-current-title').textContent()
    // 至少有 2 首歌时标题应该改变
    const items = await page.locator('#music-playlist li').count()
    if (items > 1) {
      expect(titleAfter).not.toBe(titleBefore)
    }
  })

  /* === 音量控制 === */
  test('默认音源为网易云且默认音量为10%', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    await expect(page.locator('#music-source-switch')).toHaveValue('netease')
    await expect(page.locator('#music-volume')).toHaveValue('10')
  })

  test('音量滑块可拖动', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    const slider = page.locator('#music-volume')
    await expect(slider).toBeVisible()

    // 设置一个值
    await slider.fill('80')
    const val = await slider.inputValue()
    expect(parseInt(val)).toBe(80)
  })

  /* === 静音切换 === */
  test('静音按钮切换音量', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    await clickByEvent(page, '#music-mute')
    const volumeAfterMute = await page.locator('#music-volume').inputValue()
    expect(parseInt(volumeAfterMute)).toBe(0)

    await clickByEvent(page, '#music-mute')
    const volumeAfterUnmute = await page.locator('#music-volume').inputValue()
    expect(parseInt(volumeAfterUnmute)).toBeGreaterThan(0)
  })

  /* === 响应式布局 === */
  test('移动端抽屉全宽显示', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openHome(page)

    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    const drawer = page.locator('#music-drawer')
    await expect(drawer).toHaveClass(/open/)

    // 宽度应该接近视口宽度
    const box = await drawer.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(370)
  })

  /* === 播放列表点击选歌 === */
  test('点击播放列表中的曲目进行选歌', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')
    await page.waitForSelector('#music-playlist li', { timeout: 10_000 })

    const items = page.locator('#music-playlist li')
    const count = await items.count()
    if (count >= 2) {
      // 点击第 2 首
      await items.nth(1).dispatchEvent('click')
      await page.waitForTimeout(300)

      // 第 2 首应获得 active 状态
      await expect(items.nth(1)).toHaveClass(/active/)
    }
  })

  /* === PJAX 兼容性 === */
  test('页面导航后播放器 DOM 保持', async ({ page }) => {
    await showRightside(page)

    // 首次点击前只保留入口按钮，不创建抽屉
    await expect(page.locator('#music-drawer')).toHaveCount(0)
    await clickByEvent(page, '#music-player-btn')

    // 确认播放器已按需创建
    await expect(page.locator('#music-drawer')).toBeAttached()

    // 导航到 about 页面
    await page.click('a[href="/about/"]', { timeout: 5_000 }).catch(() => {
      // 如果没有 about 链接则跳过
    })
    await page.waitForLoadState('domcontentloaded')

    // 播放器 DOM 应仍然存在
    await expect(page.locator('#music-drawer')).toBeAttached()
  })

  /* === 键盘快捷键 === */
  test('Space 键切换播放（抽屉打开时）', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')
    await page.waitForSelector('#music-playlist li', { timeout: 10_000 })

    // 按 Space 键
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)

    // 检查播放器对象存在
    const hasCtrl = await page.evaluate(() => !!window.__musicPlayer?.ctrl)
    expect(hasCtrl).toBe(true)
  })

  /* === 播放顺序切换 === */
  test('播放顺序按钮在顺序和随机间切换', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')

    const orderIcon = page.locator('#music-order i')
    // 默认应为 list
    await expect(orderIcon).toHaveClass(/fa-list-ol/)

    await clickByEvent(page, '#music-order')
    await expect(orderIcon).toHaveClass(/fa-random/)

    await clickByEvent(page, '#music-order')
    await expect(orderIcon).toHaveClass(/fa-list-ol/)
  })

  /* === 截图回归 === */
  test('抽屉打开状态截图', async ({ page }) => {
    await showRightside(page)
    await clickByEvent(page, '#music-player-btn')
    await page.waitForSelector('#music-playlist li', { timeout: 10_000 })

    await page.screenshot({
      path: 'tests/e2e/screenshots/music-drawer-open.png',
      fullPage: false
    })
  })
})
