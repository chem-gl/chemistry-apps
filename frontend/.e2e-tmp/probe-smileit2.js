const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const api = []; const apiFail = [];
  p.on('response', r => { if (r.url().includes('/api/')) { const c = `${r.status()} ${r.request().method()} ${r.url().replace('https://apps.agalano.com','').slice(0,90)}`; api.push(c); if (r.status() >= 400) apiFail.push(c); } });
  await p.goto('https://apps.agalano.com/smileit', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('app-principal-molecule-editor input', { timeout: 30000 });
  await p.fill('app-principal-molecule-editor input', 'c1(O)c(NCCC=C)c2c([nH]cc2)c([N+](=O)[O-])c1O');
  await p.locator('app-principal-molecule-editor .btn-secondary').nth(1).click();
  try { await p.waitForSelector('.inspection-floating-panel .atom-grid .atom-chip', { timeout: 60000 }); } catch (e) { console.log('no chips'); }
  // buscar targets SVG de atom 5 y 18
  const svgInfo = await p.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.principal-svg-stage svg *'));
    const hits = els.filter(el => {
      const cls = (typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '') + " " + (el.id || '') + " " + (el.getAttribute && el.getAttribute('data-atom-index') || '');
      return /atom|sites|selection/.test(cls);
    }).slice(0, 30).map(el => ({ t: el.tagName, c: (typeof el.className === 'string' ? el.className : (el.className.baseVal || '')), id: el.id, d: el.getAttribute('data-atom-index') }));
    return hits;
  });
  console.log('svgTargets:', JSON.stringify(svgInfo, null, 0).slice(0, 3000));
  // chips count
  const chipTxt = await p.evaluate(() => Array.from(document.querySelectorAll('.inspection-floating-panel .atom-chip')).slice(0, 25).map(c => c.textContent.trim().slice(0, 12)));
  console.log('chips:', JSON.stringify(chipTxt));
  await p.screenshot({ path: '/tmp/opencode/agalano2-probe-smileit2.png' });
  console.log('apifail:', apiFail.join(' | '));
  await b.close();
})();
