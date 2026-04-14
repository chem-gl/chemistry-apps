// molar-fractions.e2e.spec.ts: Valida el flujo visible de Molar Fractions con respuesta completada inmediata.
// Usa mocks de red en Playwright para asegurar que la UI renderiza resultados, tabla y gráfica sin depender del worker.

import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
import { startBrowserCoverage, stopBrowserCoverage } from './support/browser-coverage';

const BACKEND_BASE_URL = 'http://127.0.0.1:8000';
const ROOT_USERNAME = process.env['E2E_ROOT_USERNAME'] ?? 'root';
const ROOT_PASSWORD = process.env['E2E_ROOT_PASSWORD'] ?? 'admin123';
const MOCK_JOB_ID = '11111111-2222-4333-8444-555555555555';

interface AuthTokens {
  access: string;
}

function buildMockResultRows(): Array<{ ph: number; fractions: number[]; sum_fraction: number }> {
  return Array.from({ length: 15 }, (_value, index) => {
    const phValue = index;
    const species0 = Number(Math.max(0, Math.min(1, (14 - phValue) / 14)).toFixed(6));
    const species1 = Number((0.22 + 0.1 * Math.sin(index / 2)).toFixed(6));
    const species2 = Number((0.14 + 0.08 * Math.cos(index / 3)).toFixed(6));
    const partialSum = species0 + species1 + species2;
    const species3 = Number(Math.max(0, 1 - partialSum).toFixed(6));
    const normalizedSum = Number((species0 + species1 + species2 + species3).toFixed(6));

    return {
      ph: phValue,
      fractions: [species0, species1, species2, species3],
      sum_fraction: normalizedSum,
    };
  });
}

function buildCompletedMolarFractionsJob() {
  return {
    id: MOCK_JOB_ID,
    owner: 1,
    owner_username: ROOT_USERNAME,
    group: null,
    group_name: '',
    job_hash: 'mock-molar-fractions-job-hash',
    plugin_name: 'molar-fractions',
    algorithm_version: '1.0.0',
    status: 'completed',
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
    deleted_by_username: '',
    deletion_mode: '',
    scheduled_hard_delete_at: null,
    original_status: 'completed',
    cache_hit: false,
    cache_miss: true,
    progress_percentage: 100,
    progress_stage: 'completed',
    progress_message: 'Calculation completed successfully.',
    progress_event_index: 3,
    supports_pause_resume: false,
    pause_requested: false,
    runtime_state: null,
    paused_at: null,
    resumed_at: null,
    parameters: {
      pka_values: [2.2, 7.2, 12.3],
      ph_mode: 'range',
      ph_min: 0,
      ph_max: 14,
      ph_step: 1,
    },
    results: {
      species_labels: ['f0', 'f1', 'f2', 'f3'],
      rows: buildMockResultRows(),
      metadata: {
        pka_values: [2.2, 7.2, 12.3],
        ph_mode: 'range',
        ph_min: 0,
        ph_max: 14,
        ph_step: 1,
        total_species: 4,
        total_points: 15,
      },
    },
    error_trace: '',
    created_at: '2026-04-14T05:00:00Z',
    updated_at: '2026-04-14T05:00:02Z',
  };
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

async function fulfillJson(route: Route, payload: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
}

test.describe('Molar Fractions e2e', () => {
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

  // Verifica que la UI muestre resultado completo cuando el job responde como completado desde /api/jobs/.
  test('renders table and chart for a completed molar fractions job', async ({ page, request }) => {
    await authenticateAsRoot(request);
    await loginThroughUi(page, ROOT_USERNAME, ROOT_PASSWORD);

    const completedJob = buildCompletedMolarFractionsJob();

    await page.route('**/api/jobs/?plugin_name=molar-fractions', async (route) => {
      await fulfillJson(route, []);
    });

    await page.route('**/api/jobs/', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(completedJob),
        });
        return;
      }

      await route.continue();
    });

    await page.route(`**/api/jobs/${MOCK_JOB_ID}/logs/?limit=250`, async (route) => {
      await fulfillJson(route, {
        results: [],
        next_cursor: null,
      });
    });

    await page.goto('/molar-fractions');
    await page.getByRole('button', { name: /run molar fractions/i }).click();

    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
    await expect(page.getByText('Points: 15')).toBeVisible();
    await expect(page.getByText('Range: 0 to 14')).toBeVisible();
    await expect(page.getByRole('table')).toContainText('0.00');
    await expect(page.getByText('Interpolated readings at pH 7.40')).toBeVisible();
    await expect(page.locator('app-scientific-chart')).toBeVisible();
    await expect(page.locator('app-scientific-chart canvas').first()).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
});
