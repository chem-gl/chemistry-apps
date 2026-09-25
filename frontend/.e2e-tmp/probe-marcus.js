const { chromium } = require('@playwright/test');
const FIXTURE = '/home/cesar/Documents/Proyectos/chemistry-apps/backend/libs/gaussian_log_parser/fixtures/1_ceto_f3_rad_+.log';
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const api = []; const apiFail = [];
  p.on('response', r => { if (r.url().includes('/api/')) { const c = `${r.status()} ${r.request().method()} ${r.url().replace('https://apps.agalano.com','').slice(0,100)}`; api.push(c); if (r.status() >= 400) apiFail.push(c); } });
  await p.goto('https://apps.agalano.com/marcus', { waitUntil: 'domcontentloaded' });
  try { await p.waitForLoadState('networkidle', { timeout: 15000 }); } catch (e) {}
  const fin = p.locator('.marcus-shell .entry-panel input[type=file]');
  const n = await fin.count();
  for (let i = 0; i < n; i++) await fin.nth(i).setInputFiles(FIXTURE);
  await p.waitForTimeout(1500);
  const runOk = await p.waitForFunction(() => { const b = document.querySelector('.marcus-shell .entry-panel .btn-primary'); return b && !b.disabled; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  console.log('runOk:', runOk);
  if (!runOk) {
    const errs = await p.evaluate(() => Array.from(document.querySelectorAll('.marcus-shell .error-message, .marcus-shell .inspection-error')).map(e => e.textContent.trim()).filter(Boolean));
    console.log('errs:', errs);
  } else {
    await p.locator('.marcus-shell .entry-panel .btn-primary').click();
    await p.waitForTimeout(90000);
    const st = await p.evaluate(() => ({
      section: document.querySelector('.marcus-shell .result-panel')?.innerText.slice(0, 600) || '',
    }));
    console.log('panel:', st.section);
    console.log('apiFail:', apiFail.join(' | '));
    await p.screenshot({ path: '/tmp/opencode/agalano2-probe-marcus.png' });
  }
  await b.close();
})();
