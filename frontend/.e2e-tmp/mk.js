const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ headless: true });
  const page = await (await b.newContext()).newPage();
  const api = [];
  page.on('response', r => { if (r.url().includes('/api/')) api.push(`${r.status()} ${r.request().method()} ${r.url().replace('https://apps.agalano.com','').slice(0, 60)}`); });
  await page.goto('https://apps.agalano.com/tunnel', { waitUntil: 'domcontentloaded' });
  try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { }
  const modal = await page.evaluate(() => {
    const m = document.querySelector('app-global-error-modal');
    return { exists: !!m, text: m ? (m.innerText || '').slice(0, 400) : null, display: m ? getComputedStyle(m).display : null };
  });
  console.log('modal:', JSON.stringify(modal));
  console.log('api:', api.join(' | '));
  await page.evaluate(() => { const b = document.querySelector('.tunnel-shell .entry-panel .btn-primary'); b && b.click(); });
  await page.waitForTimeout(25000);
  const after = await page.evaluate(() => ({ output: (document.querySelector('.tunnel-shell .output-block') || {}).innerText?.slice(0, 200) || 'NONE', modalNow: (document.querySelector('app-global-error-modal') || {}).innerText?.slice(0, 300) || '' }));
  console.log('after:', JSON.stringify(after));
  console.log('api after:', api.join(' | '));
  await page.screenshot({ path: '/tmp/opencode/agalano2-tunnel-guest-probe.png' });
  await b.close();
})();
