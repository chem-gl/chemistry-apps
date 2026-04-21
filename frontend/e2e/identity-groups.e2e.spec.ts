// identity-groups.e2e.spec.ts: Cobertura E2E de cambio de grupo y aislamiento de permisos.
// Siembra usuarios y grupos por API para validar el flujo real del frontend Angular.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { startBrowserCoverage, stopBrowserCoverage } from './support/browser-coverage';

const BACKEND_BASE_URL = 'http://127.0.0.1:8000';
const FRONTEND_BASE_URL = 'http://127.0.0.1:4200';
const ROOT_USERNAME = process.env['E2E_ROOT_USERNAME'] ?? 'root';
const ROOT_PASSWORD = process.env['E2E_ROOT_PASSWORD'] ?? 'admin123';

interface AuthTokens {
  access: string;
}

interface WorkGroupView {
  id: number;
  name: string;
  slug: string;
}

interface IdentityUserSummaryView {
  id: number;
  username: string;
}

interface GroupMembershipView {
  id: number;
  user: number;
  group: number;
  role_in_group: 'admin' | 'member';
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

async function postJson<TResponse>(
  request: APIRequestContext,
  accessToken: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<TResponse> {
  const response = await request.post(`${BACKEND_BASE_URL}${path}`, {
    data: payload,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  expect(response.ok()).toBeTruthy();
  return (await response.json()) as TResponse;
}

async function createGroup(
  request: APIRequestContext,
  accessToken: string,
  name: string,
  slug: string,
): Promise<WorkGroupView> {
  return postJson<WorkGroupView>(request, accessToken, '/api/identity/groups/', {
    name,
    slug,
    description: `E2E group for ${name}`,
  });
}

async function createUser(
  request: APIRequestContext,
  accessToken: string,
  payload: {
    username: string;
    email: string;
    password: string;
    role: 'admin' | 'user';
    primary_group_id: number;
  },
): Promise<IdentityUserSummaryView> {
  return postJson<IdentityUserSummaryView>(request, accessToken, '/api/identity/users/', payload);
}

async function createMembership(
  request: APIRequestContext,
  accessToken: string,
  payload: {
    user: number;
    group: number;
    role_in_group: 'admin' | 'member';
  },
): Promise<GroupMembershipView> {
  return postJson<GroupMembershipView>(request, accessToken, '/api/identity/memberships/', payload);
}

async function createAppPermission(
  request: APIRequestContext,
  accessToken: string,
  payload: {
    app_name: string;
    group: number;
    is_enabled: boolean;
  },
): Promise<void> {
  await postJson(request, accessToken, '/api/identity/app-permissions/', payload);
}

async function loginThroughUi(page: Page, username: string, password: string): Promise<void> {
  await page.goto(`${FRONTEND_BASE_URL}/login`);
  await page.getByRole('textbox', { name: /username/i }).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/dashboard');
}

test.describe('Identity groups e2e', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const coverageHandle = await startBrowserCoverage(page, testInfo.title);
    testInfo.setTimeout(testInfo.timeout + 10_000);
    testInfo.annotations.push({
      type: 'browser-coverage',
      description: coverageHandle ? 'enabled' : 'disabled',
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    await stopBrowserCoverage(page, testInfo.title);
  });

  // Verifica que el ultimo grupo seleccionado domina aunque lleguen respuestas viejas despues.
  test('updates visible scientific apps after rapid group switches', async ({ page, request }) => {
    const rootAccessToken = await authenticateAsRoot(request);
    const uniqueSuffix = Date.now().toString();
    const alphaGroup = await createGroup(
      request,
      rootAccessToken,
      `Alpha ${uniqueSuffix}`,
      `alpha-${uniqueSuffix}`,
    );
    const betaGroup = await createGroup(
      request,
      rootAccessToken,
      `Beta ${uniqueSuffix}`,
      `beta-${uniqueSuffix}`,
    );
    const memberPassword = `Pass-${uniqueSuffix}`;
    const memberUser = await createUser(request, rootAccessToken, {
      username: `member_${uniqueSuffix}`,
      email: `member_${uniqueSuffix}@test.local`,
      password: memberPassword,
      role: 'user',
      primary_group_id: alphaGroup.id,
    });

    await createMembership(request, rootAccessToken, {
      user: memberUser.id,
      group: betaGroup.id,
      role_in_group: 'member',
    });
    await createAppPermission(request, rootAccessToken, {
      app_name: 'smileit',
      group: alphaGroup.id,
      is_enabled: true,
    });
    await createAppPermission(request, rootAccessToken, {
      app_name: 'marcus-kinetics',
      group: betaGroup.id,
      is_enabled: true,
    });
    await createAppPermission(request, rootAccessToken, {
      app_name: 'tunnel-effect',
      group: alphaGroup.id,
      is_enabled: false,
    });
    await createAppPermission(request, rootAccessToken, {
      app_name: 'tunnel-effect',
      group: betaGroup.id,
      is_enabled: false,
    });

    await loginThroughUi(page, memberUser.username, memberPassword);

    const navigation = page.locator('.main-nav');
    await expect(navigation).toContainText('Smileit');
    await expect(navigation).not.toContainText('Marcus Theory');
    await expect(navigation).not.toContainText('Tunnel Effect');

    await page.route('**/api/auth/apps/**', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.searchParams.get('group_id') === String(betaGroup.id)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      await route.continue();
    });

    await page.getByTestId('active-group-selector-trigger').click();
    await page.getByTestId(`group-option-${betaGroup.id}`).click();
    await page.getByTestId('active-group-selector-trigger').click();
    await page.getByTestId(`group-option-${alphaGroup.id}`).click();

    await expect(page.getByTestId('active-group-selector-trigger')).toContainText(alphaGroup.name);
    await expect(navigation).toContainText('Smileit');
    await expect(navigation).not.toContainText('Marcus Theory');
    await expect(navigation).not.toContainText('Tunnel Effect');
  });

  // Verifica que un grupo con Marcus y Smileit no muestra Tunnel si no está habilitada.
  test('shows only the enabled Marcus and Smileit apps for the active group', async ({
    page,
    request,
  }) => {
    const rootAccessToken = await authenticateAsRoot(request);
    const uniqueSuffix = `${Date.now()}-dual`;
    const alphaGroup = await createGroup(
      request,
      rootAccessToken,
      `Dual Alpha ${uniqueSuffix}`,
      `dual-alpha-${uniqueSuffix}`,
    );
    const memberPassword = `Pass-${uniqueSuffix}`;
    const memberUser = await createUser(request, rootAccessToken, {
      username: `dual_member_${uniqueSuffix}`,
      email: `dual_member_${uniqueSuffix}@test.local`,
      password: memberPassword,
      role: 'user',
      primary_group_id: alphaGroup.id,
    });

    await createAppPermission(request, rootAccessToken, {
      app_name: 'marcus-kinetics',
      group: alphaGroup.id,
      is_enabled: true,
    });
    await createAppPermission(request, rootAccessToken, {
      app_name: 'smileit',
      group: alphaGroup.id,
      is_enabled: true,
    });
    await createAppPermission(request, rootAccessToken, {
      app_name: 'tunnel-effect',
      group: alphaGroup.id,
      is_enabled: false,
    });

    await loginThroughUi(page, memberUser.username, memberPassword);

    const navigation = page.locator('.main-nav');
    await expect(navigation).toContainText('Marcus Theory');
    await expect(navigation).toContainText('Smileit');
    await expect(navigation).not.toContainText('Tunnel Effect');
  });

  // Verifica que Marcus aparece incluso cuando es la única app científica habilitada del grupo.
  test('shows Marcus when it is the only enabled scientific app', async ({ page, request }) => {
    const rootAccessToken = await authenticateAsRoot(request);
    const uniqueSuffix = `${Date.now()}-marcus-only`;
    const alphaGroup = await createGroup(
      request,
      rootAccessToken,
      `Marcus Alpha ${uniqueSuffix}`,
      `marcus-alpha-${uniqueSuffix}`,
    );
    const memberPassword = `Pass-${uniqueSuffix}`;
    const memberUser = await createUser(request, rootAccessToken, {
      username: `marcus_member_${uniqueSuffix}`,
      email: `marcus_member_${uniqueSuffix}@test.local`,
      password: memberPassword,
      role: 'user',
      primary_group_id: alphaGroup.id,
    });

    await createAppPermission(request, rootAccessToken, {
      app_name: 'marcus-kinetics',
      group: alphaGroup.id,
      is_enabled: true,
    });
    await createAppPermission(request, rootAccessToken, {
      app_name: 'smileit',
      group: alphaGroup.id,
      is_enabled: false,
    });
    await createAppPermission(request, rootAccessToken, {
      app_name: 'tunnel-effect',
      group: alphaGroup.id,
      is_enabled: false,
    });

    await loginThroughUi(page, memberUser.username, memberPassword);

    const navigation = page.locator('.main-nav');
    await expect(navigation).toContainText('Marcus Theory');
    await expect(navigation).not.toContainText('Smileit');
    await expect(navigation).not.toContainText('Tunnel Effect');
  });

  // Verifica que activar permisos en un grupo no altera el estado visual ni persistido de otro grupo.
  test('keeps app permissions isolated per group in group manager', async ({ page, request }) => {
    const rootAccessToken = await authenticateAsRoot(request);
    const uniqueSuffix = `${Date.now()}-admin`;
    const alphaGroup = await createGroup(
      request,
      rootAccessToken,
      `Managed Alpha ${uniqueSuffix}`,
      `managed-alpha-${uniqueSuffix}`,
    );
    const betaGroup = await createGroup(
      request,
      rootAccessToken,
      `Managed Beta ${uniqueSuffix}`,
      `managed-beta-${uniqueSuffix}`,
    );
    const adminPassword = `Pass-${uniqueSuffix}`;
    const adminUser = await createUser(request, rootAccessToken, {
      username: `admin_${uniqueSuffix}`,
      email: `admin_${uniqueSuffix}@test.local`,
      password: adminPassword,
      role: 'admin',
      primary_group_id: alphaGroup.id,
    });

    await createMembership(request, rootAccessToken, {
      user: adminUser.id,
      group: betaGroup.id,
      role_in_group: 'admin',
    });

    await loginThroughUi(page, adminUser.username, adminPassword);
    await page.goto(`${FRONTEND_BASE_URL}/admin/groups`);

    await page.getByTestId(`manage-group-${alphaGroup.id}`).click();

    const alphaSmileitToggle = page.getByTestId(`toggle-app-${alphaGroup.id}-smileit`);

    await expect(alphaSmileitToggle).not.toBeChecked();

    await alphaSmileitToggle.check();
    await expect(alphaSmileitToggle).toBeChecked();

    await page.getByTestId(`manage-group-${betaGroup.id}`).click();

    const betaSmileitToggle = page.getByTestId(`toggle-app-${betaGroup.id}-smileit`);
    await expect(betaSmileitToggle).not.toBeChecked();

    await page.reload();
    await page.getByTestId(`manage-group-${alphaGroup.id}`).click();
    await expect(page.getByTestId(`toggle-app-${alphaGroup.id}-smileit`)).toBeChecked();

    await page.getByTestId(`manage-group-${betaGroup.id}`).click();
    await expect(page.getByTestId(`toggle-app-${betaGroup.id}-smileit`)).not.toBeChecked();
  });
});
