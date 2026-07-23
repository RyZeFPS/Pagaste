import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

const deployedBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();

export default defineConfig({
  ...baseConfig,
  use: { ...baseConfig.use, baseURL: deployedBaseUrl ?? 'http://127.0.0.1:8081' },
  webServer: deployedBaseUrl
    ? undefined
    : {
        command: 'node scripts/serve-spa.mjs --idle-timeout=15000',
        url: 'http://127.0.0.1:8081',
        reuseExistingServer: false,
        timeout: 30_000,
      },
});
