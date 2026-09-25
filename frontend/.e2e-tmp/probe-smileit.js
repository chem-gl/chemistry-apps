const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const api = []; const apiFail = [];
  p.on('response', r => { if (r.url().includes('/api/')) { const c = `${r.status()} ${r.request().method()} ${r.url().replace('https://apps.agalano.com','').slice(0,100)}`; api.push(c); if (r.status() >= 400) apiFail.push(c); } });
  await p.goto('https://apps.agalano.com/smileit', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  const visible = await p.evaluate(() => {
    const el = document.querySelector('app-principal-molecule-editor input');
    const chips = document.querySelectorAll('.catalog-panel .btn-secondary');
    const blocks = document.querySelectorAll('.add-block-btn');
    return {
      editorInput: !!el && el.offsetParent !== null,
      editorText: document.querySelector('app-principal-molecule-editor')?.innerText.slice(0, 200) || 'NO',
      catalogButtons: chips.length, addBlock: blocks.length,
      shells: Array.from(document.querySelectorAll('app-smileit, smileit, .smileit-shell')).map(x => x.tagName + '.' + x.className).slice(0, 3),
      hosts: Array.from(document.querySelectorAll('main * ')).filter(e => e.tagName.startsWith('APP-')).map(e => e.tagName).slice(0, 15),
      body: document.body.innerText.slice(0, 400),
    };
  });
  console.log(JSON.stringify(visible, null, 1));
  await p.screenshot({ path: '/tmp/opencode/agalano2-probe-smileit.png', fullPage: false });
  console.log('apiFail:', apiFail.join(' | '));
  await b.close();
})();
