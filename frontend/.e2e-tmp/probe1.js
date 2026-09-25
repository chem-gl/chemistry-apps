const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const api = [];
  p.on('response', r => { if (r.url().includes('/api/')) api.push(`${r.status()} ${r.request().method()} ${r.url().replace('https://apps.agalano.com','')}`); });
  const dlEvents = [];
  p.on('download', d => dlEvents.push(d.suggestedFilename()));
  await p.goto('https://apps.agalano.com/molar-fractions', { waitUntil: 'domcontentloaded' });
  try { await p.waitForLoadState('networkidle', { timeout: 15000 }); } catch (e) {}
  await p.locator('.molar-shell .entry-panel .btn-primary').first().click();
  await p.waitForSelector('.molar-shell .result-table', { timeout: 120000 });
  const requests = [];
  p.on('request', r => { if (r.url().includes('/api/')) requests.push(`${r.method()} ${r.url()}`); });
  // click export y espero
  console.log('BEFORE export; api:', api.length);
  await p.locator('.molar-shell .export-row .btn-secondary').first().click();
  for (let i = 0; i < 20; i++) { await p.waitForTimeout(1000); console.log(i + 's dl=' + dlEvents.length); if (dlEvents.length) break; }
  console.log('api after export:', api.join('\n'));
  console.log('downloads:', dlEvents);
  // DOM-level probe: correr export manual y ver si anchor download funciona
  const manual = await p.evaluate(async () => {
    try {
      const r = await fetch('https://apps.agalano.com/api/x', { method: 'GET' }).catch(e => null);
      return 'fetch ok ' + (r ? r.status : 'none');
    } catch (e) { return 'err ' + e.message; }
  });
  console.log('manual:', manual);
  await b.close();
})();
