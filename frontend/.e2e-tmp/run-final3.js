// FINAL B: cuenta — register+login via Node fetch, tokens en localStorage, luego UI.
const { chromium } = require('@playwright/test');
const fs = require('fs'); const path = require('path');
const BASE = 'https://apps.agalano.com';
const results = []; const defects = [];
const report = (n, ok, ev) => { results.push({ name: n, ok, ev }); console.log(`${ok ? 'PASS' : 'FAIL'} | ${n}\n    ${ev}`); };
const defect = (sev, d, r) => { defects.push({ sev, d, r: String(r) }); console.log(`DEFECT[${sev}] ${d} :: ${String(r).slice(0, 240)}`); };
const shot = (page, n) => page.screenshot({ path: `/tmp/opencode/agalano2-${n}.png` }).catch(() => null);
const gotoApp = async (page, r) => { await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { } };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ts = Date.now();
  const testEmail = `verify2-${ts}@example.com`;
  const testUser = `verify2${String(ts).slice(-8)}`;
  const testPass = 'Test1234!e2e';
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const api = [];
    page.on('response', r => { try { const u = r.url(); if (u.includes('/api/')) api.push({ method: r.request().method(), url: u.replace(BASE, ''), status: r.status() }); } catch (e) { } });
    // base visit para origin
    await gotoApp(page, '/apps');
    const regRes = await fetch(`${BASE}/api/auth/register/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: testUser, email: testEmail, password: testPass }) });
    const regBody = await regRes.json().catch(() => null);
    report('8a. Registro cuenta (API)', regRes.status === 201, `POST /api/auth/register/ ${regRes.status} ${JSON.stringify(regBody).slice(0, 140)}`);
    const loginRes = await fetch(`${BASE}/api/auth/login/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: testUser, password: testPass }) });
    const loginBody = await loginRes.json().catch(() => null);
    console.log('login keys:', Object.keys(loginBody || {}));
    report('8b. Login (API)', loginRes.status === 200, `POST /api/auth/login/ ${loginRes.status} keys=${Object.keys(loginBody || {}).join(',').slice(0, 120)}`);
    const access = loginBody && (loginBody.access || (loginBody.tokens && loginBody.tokens.access));
    const refresh = loginBody && (loginBody.refresh || (loginBody.tokens && loginBody.tokens.refresh));
    if (access) {
      await page.evaluate(([a, r]) => { window.localStorage.setItem('chemistry-apps.access-token', a); if (r) window.localStorage.setItem('chemistry-apps.refresh-token', r); }, [access, refresh]);
    }
    // navegar a tunnel con sesión
    await gotoApp(page, '/tunnel');
    const authOk = await page.waitForSelector('.session-avatar', { timeout: 45000 }).then(() => true).catch(() => false);
    report('8b2. UI reconoce sesión (session-avatar)', authOk, `user=${testUser}`);
    await shot(page, '08b-login-b');
    if (!authOk) { defect('S1', 'Sesión no reconocida tras tokens', ''); }
    else {
      // run tunnel forzoso
      const postBefore = api.filter(c => c.method === 'POST').length;
      await page.evaluate(() => { const b = document.querySelector('.tunnel-shell .entry-panel .btn-primary'); b && b.click(); });
      try { await page.waitForSelector('.tunnel-shell .output-block', { timeout: 180000, state: 'visible' }); } catch (e) { /* */ }
      await shot(page, '08c-tunnel-b');
      const posts = api.filter(c => c.method === 'POST' && /\/api\/tunnel\/jobs\//.test(c.url));
      report('8c. Autenticado → POST /api/tunnel/jobs/ 201', posts.some(c => c.status === 201), `posts=${JSON.stringify(posts.slice(0, 2).map(c => c.status + ' ' + c.url.slice(0, 40)))}`);
      if (!posts.some(c => c.status === 201)) defect('S1', 'Job autenticado sin 201', JSON.stringify(posts.slice(0, 4)));
      const raw = await page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.tunnel-effect');
      let jobId = null; try { jobId = JSON.parse(raw)[0].jobId; } catch (e) { }
      await gotoApp(page, '/jobs');
      try { await page.waitForSelector('.job-card', { timeout: 30000 }); } catch (e) { }
      const found = jobId ? await page.waitForFunction((j) => (document.body.innerText || '').includes(j), jobId, { timeout: 30000 }).then(() => true).catch(() => false) : false;
      report('8d. Monitor lista el job', found, `jobId=${jobId}`);
      await shot(page, '08d-monitor-b');
      if (jobId && !found) defect('S2', 'Job no visible en monitor', `jobId=${jobId}`);
      const logoutBtns = await page.locator('.session-button').count();
      if (logoutBtns) {
        await page.locator('.session-button').click();
        const gone = await page.waitForFunction(() => window.localStorage.getItem('chemistry-apps.access-token') === null, null, { timeout: 25000 }).then(() => true).catch(() => false);
        const signIn = await page.evaluate(() => (document.body.innerText || '').toLowerCase().includes('sign in'));
        report('8e. Sign out → invitado', gone && signIn, `tokenRemoved=${gone} signInLink=${signIn}`);
        await shot(page, '08e-logout-b');
        if (!gone) defect('S2', 'Sign out deja token', '');
      } else defect('S2', 'session-button ausente', '');
    }
  } finally {
    await browser.close();
    console.log(`\nFINAL-B PASS ${results.filter(r => r.ok).length}/${results.length}`);
    defects.forEach(d => console.log(`  [${d.sev}] ${d.d} :: ${d.r.slice(0, 240)}`));
    fs.writeFileSync('/tmp/opencode/agalano2-final-b.json', JSON.stringify({ results, defects }, null, 2));
  }
})();
