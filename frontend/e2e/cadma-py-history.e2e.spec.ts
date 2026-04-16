// cadma-py-history.e2e.spec.ts: Valida que CADMA Py muestre ejecuciones previas,
// sus estados y que abrir un histórico recupere los datos visibles del resultado.

import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
import { startBrowserCoverage, stopBrowserCoverage } from './support/browser-coverage';

const BACKEND_BASE_URL = 'http://127.0.0.1:8000';
const ROOT_USERNAME = process.env['E2E_ROOT_USERNAME'] ?? 'root';
const ROOT_PASSWORD = process.env['E2E_ROOT_PASSWORD'] ?? 'admin123';
const CADMA_HISTORY_JOB_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

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

function buildCadmaHistoryJobList() {
  return [
    {
      id: CADMA_HISTORY_JOB_ID,
      plugin_name: 'cadma-py',
      status: 'completed',
      parameters: {
        reference_library_id: 'lib-neuro-1',
        project_label: 'Recovered CADMA batch',
      },
      results: null,
      created_at: '2026-04-15T12:00:00Z',
      updated_at: '2026-04-15T12:30:00Z',
    },
    {
      id: 'ffffffff-1111-4222-8333-444444444444',
      plugin_name: 'cadma-py',
      status: 'failed',
      parameters: {
        reference_library_id: 'lib-neuro-1',
        project_label: 'Broken CADMA batch',
      },
      results: null,
      created_at: '2026-04-15T11:00:00Z',
      updated_at: '2026-04-15T11:05:00Z',
    },
  ];
}

function buildCadmaHistoricalJobDetails() {
  return {
    id: CADMA_HISTORY_JOB_ID,
    plugin_name: 'cadma-py',
    status: 'completed',
    parameters: {
      reference_library_id: 'lib-neuro-1',
      project_label: 'Recovered CADMA batch',
      combined_csv_text: 'name,smiles\nMol A,CCO\nMol B,CCC',
      source_configs_json: JSON.stringify([
        {
          filename: 'historical-bundle.csv',
          content_text: 'name,smiles\nMol A,CCO\nMol B,CCC',
          file_format: 'csv',
          has_header: true,
          skip_lines: 0,
          delimiter: ',',
          smiles_column: 'smiles',
          name_column: 'name',
        },
      ]),
    },
    results: {
      library_name: 'Recovered neuro family',
      disease_name: 'Neurological disorder',
      reference_count: 8,
      candidate_count: 2,
      reference_stats: [],
      ranking: [
        {
          name: 'Mol A',
          smiles: 'CCO',
          selection_score: 0.81,
          adme_alignment: 0.78,
          toxicity_alignment: 0.85,
          sa_alignment: 0.8,
          adme_hits_in_band: 6,
          metrics_in_band: ['MW', 'logP'],
          best_fit_summary: 'Balanced profile',
        },
        {
          name: 'Mol B',
          smiles: 'CCC',
          selection_score: 0.44,
          adme_alignment: 0.42,
          toxicity_alignment: 0.5,
          sa_alignment: 0.4,
          adme_hits_in_band: 3,
          metrics_in_band: ['MW'],
          best_fit_summary: 'Partial fit',
        },
      ],
      score_chart: {
        categories: ['Mol A', 'Mol B'],
        values: [0.81, 0.44],
        reference_line: 0.5,
      },
      metric_charts: [
        {
          metric: 'MW',
          label: 'Molecular Weight',
          categories: ['Mol A', 'Mol B'],
          values: [320, 280],
          reference_mean: 300,
          reference_low: 250,
          reference_high: 350,
          better_direction: 'balanced',
        },
      ],
      methodology_note: 'Recovered historical CADMA analysis.',
    },
    error_trace: '',
    created_at: '2026-04-15T12:00:00Z',
    updated_at: '2026-04-15T12:30:00Z',
  };
}

test.describe('CADMA Py history e2e', () => {
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

  test('shows previous CADMA executions with their states and opens the stored result data', async ({
    page,
    request,
  }) => {
    await authenticateAsRoot(request);
    await loginThroughUi(page, ROOT_USERNAME, ROOT_PASSWORD);

    const historyJobs = buildCadmaHistoryJobList();
    const historicalJob = buildCadmaHistoricalJobDetails();

    await page.route('**/api/cadma-py/jobs/reference-libraries/', async (route) => {
      await fulfillJson(route, [
        {
          id: 'lib-neuro-1',
          name: 'Recovered neuro family',
          disease_name: 'Neurological disorder',
          description: 'Historical family used for regression coverage.',
          source_reference: 'root',
          group_id: null,
          created_by_id: 1,
          created_by_name: 'root',
          editable: false,
          deletable: false,
          forkable: false,
          row_count: 8,
          rows: [],
          source_file_count: 1,
          source_files: [],
          paper_reference: '',
          paper_url: '',
          created_at: '2026-04-15T12:00:00Z',
          updated_at: '2026-04-15T12:30:00Z',
        },
      ]);
    });

    await page.route('**/api/cadma-py/jobs/reference-samples/', async (route) => {
      await fulfillJson(route, []);
    });

    await page.route('**/api/jobs/**', async (route) => {
      const requestUrl = route.request().url();

      if (requestUrl.includes('/api/jobs/?plugin_name=cadma-py')) {
        await fulfillJson(route, historyJobs);
        return;
      }

      if (requestUrl.includes(`/api/jobs/${CADMA_HISTORY_JOB_ID}/`)) {
        await fulfillJson(route, historicalJob);
        return;
      }

      await route.continue();
    });

    await page.goto('/cadma-py');

    await expect(page.getByRole('heading', { name: 'Previous executions' })).toBeVisible();
    await expect(page.locator('app-job-history-table')).toContainText('completed');
    await expect(page.locator('app-job-history-table')).toContainText('failed');
    await expect(page.locator('app-job-history-table')).toContainText('Recovered CADMA batch');

    await page.getByRole('button', { name: 'Open' }).first().click();

    await expect(page.getByRole('heading', { name: 'Selection scores' })).toBeVisible();
    await expect(page.getByText('Recovered historical CADMA analysis.')).toBeVisible();
    await expect(
      page.locator('.results-section').getByText('Recovered neuro family', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.result-table').getByText('Mol A', { exact: true }).first(),
    ).toBeVisible();
  });
});
