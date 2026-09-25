const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext()).newPage();
  const logs = [];
  page.on('console', m => logs.push(`${m.type()}: ${m.text().slice(0, 300)}`));
  const api = [];
  page.on('response', r => { if (r.url().includes('/api/')) api.push(`${r.status()} ${r.url().replace('https://apps.agalano.com', '').slice(0, 60)}`); });
  // bloquear catalog para simular fallo y ver repinta
  await page.route('**/api/public/catalog/', route => route.abort('connectionrefused'));
  await page.goto('https://apps.agalano.com/molar-fractions', { waitUntil: 'domcontentloaded' });
  try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { }
  console.log('API:', api.join(' | '));
  console.log('LOGS:'); logs.slice(0, 10).forEach(l => console.log(' ', l));
  await b.close();
})();
