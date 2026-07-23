import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/playwright',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer:
    process.env.PW_EXTERNAL_SERVER === '1'
      ? undefined
      : {
          command: 'node node_modules/expo/bin/cli start --web --port 8081',
          url: 'http://127.0.0.1:8081',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
            EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_local_only',
            EXPO_PUBLIC_APP_URL: 'http://127.0.0.1:8081',
          },
        },
});
