// cadma-py-copy.e2e.spec.ts: Verifica que una copia de familia CADMA se vea de inmediato sin recargar.

import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
import { startBrowserCoverage, stopBrowserCoverage } from './support/browser-coverage';

const BACKEND_BASE_URL = 'http://127.0.0.1:8000';
const ROOT_USERNAME = process.env['E2E_ROOT_USERNAME'] ?? 'root';
const ROOT_PASSWORD = process.env['E2E_ROOT_PASSWORD'] ?? 'admin123';

interface AuthTokens {
  access: string;
}

async function authenticateAsRoot(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${BACKEND_BASE_URL}/api/auth/login/`, {
    data: {
      username: ROOT_USERNAME,
      password: ROOT_PASSWORD,
    },
  });

  expect(response.ok()).toBeTruthy();
  const tokens = (await response.json()) as AuthTokens;
  return tokens.access;
}

async function loginThroughUi(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: /username/i }).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/dashboard');
}

async function fulfillJson(route: Route, payload: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

test.describe('CADMA Py copy e2e', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const coverageEnabled = await startBrowserCoverage(page, testInfo.title);
    testInfo.annotations.push({
      type: 'browser-coverage',
      description: coverageEnabled ? 'enabled' : 'disabled',
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    await stopBrowserCoverage(page, testInfo.title);
  });

  test('shows the copied family immediately after creating it', async ({ page, request }) => {
    await authenticateAsRoot(request);
    await loginThroughUi(page, ROOT_USERNAME, ROOT_PASSWORD);

    const originalLibrary = {
      id: 'root-lib-1',
      name: 'Root Neuro Template',
      disease_name: 'Neuro disease',
      description: 'Bundled template',
      source_reference: 'root',
      group_id: null,
      created_by_id: 1,
      created_by_name: 'root',
      editable: false,
      deletable: false,
      forkable: true,
      row_count: 2,
      rows: [],
      source_file_count: 0,
      source_files: [],
      paper_reference: '',
      paper_url: '',
      created_at: '2026-04-15T12:00:00Z',
      updated_at: '2026-04-15T12:00:00Z',
    };

    const copiedLibrary = {
      ...originalLibrary,
      id: 'copied-lib-99',
      name: 'Immediate Neuro Copy',
      source_reference: 'local-lab',
      editable: true,
      deletable: true,
      forkable: false,
      created_by_name: ROOT_USERNAME,
    };

    let listCallCount = 0;

    await page.route('**/api/cadma-py/jobs/reference-libraries/', async (route) => {
      listCallCount += 1;
      await fulfillJson(
        route,
        listCallCount < 2 ? [originalLibrary] : [originalLibrary, copiedLibrary],
      );
    });

    await page.route('**/api/cadma-py/jobs/reference-samples/', async (route) => {
      await fulfillJson(route, []);
    });

    await page.route('**/api/cadma-py/jobs/reference-libraries/root-lib-1/fork/', async (route) => {
      await fulfillJson(route, copiedLibrary, 201);
    });

    await page.route('**/api/jobs/?plugin_name=cadma-py', async (route) => {
      await fulfillJson(route, []);
    });

    await page.goto('/cadma-py');
    await page.getByText('Root Neuro Template').click();
    await page.getByRole('button', { name: /copy family/i }).click();
    await page.getByPlaceholder('Editable copy name').fill('Immediate Neuro Copy');
    await page.getByRole('button', { name: 'Create copy' }).click();

    await expect(page.locator('.selected-summary')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /immediate neuro copy/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible();
    await expect(page.locator('.family-edit-form .edit-input').first()).toHaveValue(
      'Immediate Neuro Copy',
    );
  });
});
