import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './playwright',
  forbidOnly: Boolean(process.env['CI']),
  timeout: 10_000,
  globalTimeout: 120_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results/playwright',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
