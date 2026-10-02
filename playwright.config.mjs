import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.mjs',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3338',
    timezoneId: 'Europe/Brussels',
    locale: 'nl-BE',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    // Alle gewone specs: serviceWorkers blijft 'block' (hierboven). De SW-specs (e2e/sw/) draaien enkel in het project 'sw'.
    { name: 'chromium', testIgnore: 'sw/**', use: { ...devices['Desktop Chrome'] } },
    // Echte service worker (etappe 7, Task 5). Extra slot bovenop de route-sloten van e2e/productie-hulp.mjs en e2e/sw-hulp.mjs:
    // de browser lost buiten localhost en de twee CDN-hosts geen enkele naam op (ook niet voor de service worker zelf).
    {
      name: 'sw',
      testMatch: 'sw/**/*.spec.mjs',
      use: {
        ...devices['Desktop Chrome'],
        serviceWorkers: 'allow',
        launchOptions: {
          args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE cdnjs.cloudflare.com, EXCLUDE cdn.jsdelivr.net'],
        },
      },
    },
  ],
  webServer: {
    command: 'node e2e/statische-server.mjs',
    port: 3338,
    reuseExistingServer: false,
  },
});
