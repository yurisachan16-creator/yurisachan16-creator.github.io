import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'launch/src/**/*.test.ts',
      'tests/unit/genshin-launch-policies.test.js',
      'tests/unit/genshin-launch.test.js',
    ],
    globals: true,
    coverage: {
      provider: 'v8',
      all: true,
      include: [
        'launch/src/audio-policy.ts',
        'launch/src/config.ts',
        'launch/src/lifecycle.ts',
        'source/js/genshin-launch-policies.js',
      ],
      reportsDirectory: 'coverage/launch',
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
})
