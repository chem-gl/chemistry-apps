// entry-door.e2e.spec.ts: Puerta de entrada institucional, i18n y modo libre.
// Verifica lo que ve un visitante sin cuenta y el inicio de sesión real, sin
// depender del worker: el render de resultados con mocks ya vive en
// molar-fractions.e2e.spec.ts.

import { expect, test, type Page } from '@playwright/test';

const LANGUAGE_PREFERENCE_KEY = 'chemistry-apps.language-preference';
const E2E_USERNAME = process.env['E2E_ROOT_USERNAME'] ?? 'root';
const E2E_PASSWORD = process.env['E2E_ROOT_PASSWORD'] ?? 'admin123';

/** Fija el idioma antes de cargar la app para que las aserciones sean estables. */
async function useLanguage(page: Page, languageCode: string): Promise<void> {
  await page.addInitScript(
    ([key, code]) => window.localStorage.setItem(key, code),
    [LANGUAGE_PREFERENCE_KEY, languageCode],
  );
}

test.describe('Puerta de entrada', () => {
  test('presenta el proyecto, el equipo con fotos y las publicaciones', async ({ page }) => {
    await useLanguage(page, 'en');
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Theoretical and Applied Chemistry',
    );
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('img[alt="UNAM"]')).toBeVisible();

    const developerCards = page.locator('.developer-card');
    await expect(developerCards).toHaveCount(5);
    await expect(page.getByRole('heading', { name: 'Development Team' })).toBeVisible();

    const photosLoaded = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLImageElement>('.developer-photo')).every(
        (photo) => photo.complete && photo.naturalWidth > 0,
      ),
    );
    expect(photosLoaded).toBe(true);

    await expect(page.locator('.publication-card')).toHaveCount(4);
    expect(consoleErrors).toEqual([]);
  });

  test('traduce la interfaz al español y vuelve al inglés', async ({ page }) => {
    await useLanguage(page, 'en');
    await page.goto('/apps');
    await expect(page.locator('.hero-title')).toHaveText(
      'Run a calculation without signing up.',
    );

    await page.locator('.language-toggle').click();
    await page.locator('.language-option', { hasText: 'Español' }).first().click();
    await expect(page.locator('.hero-title')).toHaveText(
      'Calcula sin crear cuenta.',
    );
    await expect(page.getByRole('heading', { name: 'Sin cuenta' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Con cuenta' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('appsHub.');

    await page.locator('.language-toggle').click();
    await page.locator('.language-option', { hasText: 'English' }).first().click();
    await expect(page.locator('.hero-title')).toHaveText(
      'Run a calculation without signing up.',
    );
  });

  test('invitado ve las apps libres y la app con cuenta bloqueada', async ({ page }) => {
    await useLanguage(page, 'en');
    await page.goto('/apps');

    await expect(page.getByRole('heading', { name: 'No account' })).toBeVisible();
    await expect(page.locator('.zone').first().locator('.app-node')).toHaveCount(7);
    await expect(page.getByRole('heading', { name: 'With account' })).toBeVisible();
    await expect(page.locator('.node-badge.is-locked').first()).toBeVisible();
    await expect(page.locator('.session-panel')).not.toContainText('Sign out');

    await page.locator('a.node-link', { hasText: 'Molar Fractions' }).first().click();
    await expect(page).toHaveURL(/\/molar-fractions$/);
    await expect(page.getByRole('button', { name: 'Run Molar Fractions' })).toBeVisible();
  });

  test('el invitado llega al modo libre desde la puerta de entrada', async ({ page }) => {
    await useLanguage(page, 'en');
    await page.goto('/login');

    await page.getByRole('link', { name: 'Explore without an account' }).click();

    await expect(page).toHaveURL(/\/apps$/);
    await expect(page.getByRole('heading', { name: 'No account' })).toBeVisible();
  });

  test('el inicio de sesión deja la sesión activa', async ({ page }) => {
    await useLanguage(page, 'en');
    await page.goto('/login');

    await page.fill("input[name='username']", E2E_USERNAME);
    await page.fill("input[name='password']", E2E_PASSWORD);
    await page.locator("button[type='submit']").click();

    await expect(page).toHaveURL(/\/apps$/, { timeout: 15_000 });
    await expect(page.locator('.session-panel')).toContainText('Sign out');
  });
});
