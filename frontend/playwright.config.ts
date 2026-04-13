// playwright.config.ts: Configuracion E2E para identidad, grupos y permisos en Angular.
// Levanta backend y frontend locales cuando no existen servidores previos reutilizables.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4200',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'poetry run python manage.py up --without-celery',
      cwd: '../backend',
      url: 'http://127.0.0.1:8000/api/schema/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm start',
      cwd: '.',
      url: 'http://127.0.0.1:4200/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
