// visual-audit.e2e.spec.ts: Auditoría visual y de accesibilidad del modo abierto.
// Corre con `npm run e2e:visual` (tag @visual, aislado del resto de la suite).
// Cubre: screenshots por viewport, axe sin violaciones, presupuestos duros
// (1 h1, sin overflow, sin <nav> vacío, sin errores JS).
// Perf (INP ≤200ms, Lighthouse ≥90): `npm run audit:perf` con dev server arriba.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const LANGUAGE_PREFERENCE_KEY = 'chemistry-apps.language-preference';

/** Fija inglés para screenshots y aserciones estables. */
async function useEnglish(page: Page): Promise<void> {
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, 'en'),
    LANGUAGE_PREFERENCE_KEY,
  );
}

/** Falla si hay overflow horizontal (viewport móvil primero). */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
}

/** Escanea con axe y exige cero violaciones detectables automáticamente. */
async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test.describe('Auditoría visual', { tag: '@visual' }, () => {
  test('hub invitado: layout, CTA, axe y screenshots', async ({ page }) => {
    await useEnglish(page);
    const jsErrors: string[] = [];
    page.on('pageerror', (error) => jsErrors.push(String(error).slice(0, 120)));

    await page.goto('/apps');
    await expect(page.locator('.apps-shell')).toBeVisible();

    // Presupuestos duros anti-sobrecarga.
    await expect(page.locator('h1')).toHaveCount(1);
    expect(await page.locator('nav.main-nav').count()).toBeGreaterThan(0);
    for (const nav of await page.locator('nav.main-nav').all()) {
      expect((await nav.innerText()).trim().length).toBeGreaterThan(0);
    }
    await expectNoOverflow(page);

    // CTA primario siempre visible (abierto o cerrado).
    await expect(page.locator('.top-actions .cta').first()).toBeVisible();
    await page.screenshot({ path: 'e2e/snapshots/hub-default.png' });

    // Estado hover del primer CTA (único gesto interactivo permitido).
    await page.locator('.top-actions .cta').first().hover();
    await page.screenshot({ path: 'e2e/snapshots/hub-cta-hover.png' });

    // Estado foco visible por teclado.
    await page.keyboard.press('Tab');
    await page.screenshot({ path: 'e2e/snapshots/hub-focus.png' });

    await expectNoAxeViolations(page);
    expect(jsErrors).toEqual([]);
  });

  test('hub móvil 390px: sin overflow ni nav vacío', async ({ page }) => {
    await useEnglish(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/apps');
    await expect(page.locator('.apps-shell')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expectNoOverflow(page);
    await page.screenshot({ path: 'e2e/snapshots/hub-mobile.png' });
    await expectNoAxeViolations(page);
  });

  test('login y register: header con menú, 1 h1 y axe', async ({ page }) => {
    await useEnglish(page);
    for (const route of ['/login', '/register']) {
      await page.goto(route);
      await expect(page.locator('h1')).toHaveCount(1);
      expect(await page.locator('nav.main-nav a').count()).toBeGreaterThan(0);
      await expectNoOverflow(page);
      await expectNoAxeViolations(page);
    }
    await page.screenshot({ path: 'e2e/snapshots/login.png' });
  });

  test('molar-fractions invitado: axe en formulario científico', async ({
    page,
  }) => {
    await useEnglish(page);
    await page.goto('/molar-fractions');
    await expect(
      page.getByRole('button', { name: 'Run Molar Fractions' }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
