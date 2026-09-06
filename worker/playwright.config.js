import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./browser', workers:1,
  use:{baseURL:'http://127.0.0.1:4173',channel:process.env.PLAYWRIGHT_CHANNEL||'chromium'},
  globalSetup:'./browser/server.js'
});
