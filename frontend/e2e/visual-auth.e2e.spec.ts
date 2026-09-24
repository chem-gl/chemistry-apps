// visual-auth.e2e.spec.ts: Auditoría con sesión (Fase 1 profunda).
// Recorre hub + 7 apps + jobs + profile: 1 h1, sin overflow, sin <nav> vacío,
// sin secciones vacías, sin errores JS, screenshots y axe.
// Corre con `npm run e2e:visual`. CADMA-Py se omite si el grupo activo la
// redirige al hub (RBAC por grupo, comportamiento esperado).

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const E2E_USERNAME = process.env['E2E_ROOT_USERNAME'] ?? 'root';
const E2E_PASSWORD = process.env['E2E_ROOT_PASSWORD'] ?? 'admin123';

const AUTH_ROUTES = [
  'apps',
  'molar-fractions',
  'tunnel',
  'easy-rate',
  'marcus',
  'smileit',
  'sa-score',
  'toxicity-properties',
  'jobs',
  'profile',
] as const;

/** Secciones con HTML pero sin texto ni medio: huecos visuales. */
async function emptySections(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('section, main, .zone, .panel, .card')]
      .filter((el) => {
        const text = el.textContent?.trim() ?? '';
        const html = el.innerHTML.trim();
        return (
          html.length > 0 &&
          text.length === 0 &&
          el.querySelectorAll('canvas,svg,img,input,table').length === 0
        );
      })
      .map((el) => el.className.toString().slice(0, 60)),
  );
}

test.describe('Auditoría visual con sesión', { tag: '@visual' }, () => {
  test('todas las apps: estructura, screenshots y axe', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (error) => jsErrors.push(String(error).slice(0, 120)));

    await page.goto('/login');
    await page.fill("input[name='username']", E2E_USERNAME);
    await page.fill("input[name='password']", E2E_PASSWORD);
    await page.locator("button[type='submit']").click();
    await expect(page).toHaveURL(/\/apps$/, { timeout: 20_000 });

    for (const route of AUTH_ROUTES) {
      await page.goto(`/${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);

      // Un solo h1 (el de marca): el título de página es h2.
      await expect(page.locator('h1'), route).toHaveCount(1);
      // Sin overflow horizontal.
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        route,
      ).toBe(false);
      // Sin menús vacíos ni secciones huecas.
      for (const nav of await page.locator('nav').all()) {
        expect((await nav.innerText()).trim().length, route).toBeGreaterThan(0);
      }
      expect(await emptySections(page), route).toEqual([]);

      await page.screenshot({ path: `e2e/snapshots/auth-${route}.png` });
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, route).toEqual([]);
    }

    expect(jsErrors).toEqual([]);
  });
});
