import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./browser', workers:1, forbidOnly:Boolean(process.env.CI), retries:0,
  use:{baseURL:'http://127.0.0.1:4173',channel:process.env.PLAYWRIGHT_CHANNEL||'chromium',trace:'retain-on-failure',screenshot:'only-on-failure'},
  globalSetup:'./browser/server.js'
});
