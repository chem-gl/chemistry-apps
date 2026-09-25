const { chromium } = require('@playwright/test');
const FIXTURE = '/home/cesar/Documents/Proyectos/chemistry-apps/backend/libs/gaussian_log_parser/fixtures/1_ceto_f3_rad_+.log';
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const api = [];
  p.on('response', r => { if (r.url().includes('/api/')) api.push(`${r.status()} ${r.request().method()} ${r.url().replace('https://apps.agalano.com','').slice(0,90)}`); });
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0,150)); });
  await p.goto('https://apps.agalano.com/easy-rate', { waitUntil: 'domcontentloaded' });
  try { await p.waitForLoadState('networkidle', { timeout: 15000 }); } catch (e) {}
  const fin = p.locator('.easy-rate-shell .entry-panel input[type=file]');
  const n = await fin.count();
  for (let i = 0; i < n; i++) await fin.nth(i).setInputFiles(FIXTURE);
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(2000);
    const st = await p.evaluate(() => {
      const cards = document.querySelectorAll('.easy-rate-shell .inspection-card');
      const previews = document.querySelectorAll('.easy-rate-shell .inspection-card .preview-grid');
      const hasError = Array.from(document.querySelectorAll('.easy-rate-shell .inspection-error, .easy-rate-shell .inspection-status')).map(e => e.textContent.trim()).filter(Boolean);
      const btn = document.querySelector('.easy-rate-shell .entry-panel .btn-primary');
      const sel = Array.from(document.querySelectorAll('.easy-rate-shell .execution-selector select')).map(s => ({ disabled: s.disabled, opts: Array.from(s.options).map(o => o.text.slice(0, 40)) }));
      const err = document.querySelector('.easy-rate-shell .error-message');
      return { cards: cards.length, previews: previews.length, msgs: hasError.slice(0, 6), btnDisabled: btn ? btn.disabled : null, sel, pageErr: err ? err.textContent.trim().slice(0, 120) : null };
    });
    console.log(i, JSON.stringify(st));
    if (!st.btnDisabled && st.msgs.every(x => !/analyzing/i.test(x || ''))) break;
  }
  try { const b2 = await p.locator('.easy-rate-shell .entry-panel .btn-primary').click({ timeout: 5000 }); } catch (e) { console.log('click fail', e.message.slice(0, 60)); }
  await p.waitForTimeout(15000);
  console.log('api:', api.join('\n'));
  console.log('consoleErrors:', errs.slice(0, 5).join(' || '));
  await p.screenshot({ path: '/tmp/opencode/agalano2-probe-easyrate.png' });
  const kv = await p.locator('.easy-rate-shell .kv-value').allTextContents().catch(() => []);
  console.log('kv:', JSON.stringify(kv));
  await b.close();
})();
