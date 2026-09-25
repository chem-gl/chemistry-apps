const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext();
  await ctx.addInitScript(() => {
    try {
      const id = window.localStorage.getItem.bind(window.localStorage);
      window.localStorage.getItem = function (k) { try { return id.call(window.localStorage, k); } catch (e) { console.log('LS-FAIL ' + k + ' ' + e.message); return 'x'; } };
    } catch (e) { /* */ }
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text().slice(0, 220)}`));
  const api = [];
  page.on('response', r => { if (r.url().includes('/api/')) api.push(`${r.status()} ${r.url().replace('https://apps.agalano.com', '').slice(0, 60)}`); });
  await page.goto('https://apps.agalano.com/molar-fractions', { waitUntil: 'domcontentloaded' });
  try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { }
  console.log('API:', api.join(' | '));
  console.log('LOGS:'); logs.slice(0, 12).forEach(l => console.log(' ', l));
  await b.close();
})();
