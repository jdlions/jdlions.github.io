import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./browser',testMatch:'mobile-workspace.spec.js',workers:1,
 use:{baseURL:'http://127.0.0.1:4173'},
 projects:[{name:'Chrome',use:{browserName:'chromium',channel:'chrome'}},{name:'WebKit',use:{browserName:'webkit'}}],
 globalSetup:'./browser/server.js',outputDir:'./test-results/mobile'
});
