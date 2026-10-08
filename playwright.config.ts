import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: 'list',
  use: {
    baseURL: 'https://automationintesting.online/',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
});
