import { defineConfig, devices } from '@playwright/test'

// Pin visual WebGL to software ANGLE. Headless Chromium disables its legacy
// automatic SwiftShader fallback on some runners; opting in explicitly keeps
// shader output deterministic and makes a missing WebGL2 context a real test
// failure instead of silently replacing the Three.js scene with a CSS mock.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }]],
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        }
      }
    }
  ],
  webServer: {
    command: 'npm run server',
    url: 'http://localhost:4000',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000
  }
})
