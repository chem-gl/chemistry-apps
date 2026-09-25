const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const api = [];
  p.on('response', r => { if (r.url().includes('/api/')) api.push(`${r.status()} ${r.request().method()} ${r.url().replace('https://apps.agalano.com','').slice(0, 70)}`); });
  await p.goto('https://apps.agalano.com/smileit', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('app-principal-molecule-editor input');
  await p.fill('app-principal-molecule-editor input', 'c1(O)c(NCCC=C)c2c([nH]cc2)c([N+](=O)[O-])c1O');
  await p.locator('app-principal-molecule-editor .btn-secondary').nth(1).click();
  await p.waitForSelector('.inspection-floating-panel .atom-grid .atom-chip', { timeout: 60000 });
  await p.locator('.inspection-floating-panel .atom-chip', { hasText: '#5' }).first().click();
  console.log(await dump(p, 'sel5'));
  await p.locator('.inspection-floating-panel .atom-chip', { hasText: '#18' }).first().click();
  console.log(await dump(p, 'sel18'));
  await p.locator('.add-block-btn').first().click();
  await p.waitForSelector('.block-card');
  console.log(await dump(p, 'blockcreated'));
  const bc = p.locator('.block-card').first();
  await bc.locator('.atom-chip.compact', { hasText: '5' }).first().click();
  console.log(await dump(p, 'blockSite5'));
  await bc.locator('.atom-chip.compact', { hasText: '18' }).first().click();
  console.log(await dump(p, 'blockSite18'));
  const adds = bc.locator('button.catalog-add');
  const nAdd = await adds.count();
  console.log('addButtons:', nAdd);
  const info = [];
  for (let i = 0; i < Math.min(nAdd, 4); i++) {
    info.push({ enabled: await adds.nth(i).isEnabled(), label: (await adds.nth(i).textContent() || '').trim().slice(0, 24) });
  }
  console.log('addInfo:', JSON.stringify(info));
  if (nAdd) { await adds.nth(0).click(); await p.waitForTimeout(2000); console.log(await dump(p, 'afterAdd')); }
  console.log('api tail:', api.slice(-8).join(' ; '));
  await p.screenshot({ path: '/tmp/opencode/agalano2-probe-smi3.png' });
  await b.close();
  async function dump(page, tag) {
    const s = await page.evaluate(() => {
      const txt = (sel) => Array.from(document.querySelectorAll(sel)).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12);
      const bc = document.querySelector('.block-card');
      return {
        selSites: txt('.hero-card p')[0] || '',
        coverage: Array.from(document.querySelectorAll('.hero-card')).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)),
        warning: txt('.atom-selection-sticky .warning-message')[0] || null,
        blockChips: bc ? Array.from(bc.querySelectorAll('.atom-chip.compact')).map(c => c.className.includes('selected')) : [],
        blockSections: bc ? Array.from(bc.querySelectorAll('h4, .hint')).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)).slice(0, 8) : [],
        blocksSummary: bc ? (bc.innerText || '').slice(0, 420) : '',
      };
    });
    return tag + ' :: ' + JSON.stringify(s).slice(0, 1400);
  }
})();
