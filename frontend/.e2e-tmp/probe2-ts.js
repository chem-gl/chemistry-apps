const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext()).newPage();
  const api = [];
  p.on('response', r => { if (r.url().includes('/api/')) api.push(`${r.status()} ${r.request().method()} ${r.url().slice(-52)}`); });
  await p.goto('https://apps.agalano.com/easy-rate', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.easy-rate-shell .entry-panel input[type=file]');
  await p.setInputFiles('.easy-rate-shell .entry-panel .file-slot-card:nth-child(1) input[type=file]', '/home/cesar/Documents/Proyectos/chemistry-apps/frontend/.e2e-tmp/tsfile.log');
  await p.waitForTimeout(9000);
  const preview = await p.evaluate(() => {
    const card = document.querySelector('.easy-rate-shell .inspection-card');
    return {
      error: Array.from(document.querySelectorAll('.inspection-error, .inspection-warning')).map(e => e.textContent.trim().slice(0, 130)),
      preview: card ? (card.querySelector('.preview-grid') || {}).innerText?.slice(0, 260) : null,
      runDisabled: document.querySelector('.easy-rate-shell .entry-panel .btn-primary')?.disabled,
    };
  });
  console.log(JSON.stringify(preview, null, 1));
  console.log('api:', api.join(' | '));
  await b.close();
})();
