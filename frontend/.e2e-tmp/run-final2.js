// FINAL A: cuenta completa (tunnel API POST 201 + owner via monitor).
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const BASE = 'https://apps.agalano.com';
const results = []; const defects = [];
function report(n, ok, ev) { results.push({ name: n, ok, ev }); console.log(`${ok ? 'PASS' : 'FAIL'} | ${n}\n    ${ev}`); }
function defect(sev, d, r) { defects.push({ sev, d, r: String(r) }); console.log(`DEFECT[${sev}] ${d} :: ${String(r).slice(0, 240)}`); }
async function shot(page, n) { try { return await page.screenshot({ path: `/tmp/opencode/agalano2-${n}.png` }); } catch (e) { return null; } }
async function gotoApp(page, r) { await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { } }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ts = Date.now();
  const testEmail = `verify2-${ts}@example.com`;
  const testUser = `verify2${String(ts).slice(-8)}`;
  const testPass = 'Test1234!e2e';
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    const api = []; const apiFail = [];
    page.on('response', r => { try { const u = r.url(); if (u.includes('/api/')) { const c = { method: r.request().method(), url: u.replace(BASE, ''), status: r.status() }; api.push(c); if (c.status >= 400) apiFail.push(c); } } catch (e) { } });
    // registry + login via API
    const reg = await page.evaluate(async ({ u, e, p }) => {
      const r = await fetch('/api/auth/register/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, email: e, password: p }) });
      return set_cont(r.status, await r.json().catch(() => null));
      function set_x() { return null; }
    }, { u: testUser, e: testEmail, p: testPass }).catch(x => ({ status: 0, body: null }));
    // AGUAS: evaluate arg destructure ok
    report('8a. Registro cuenta', reg.status === 201, `POST /api/auth/register/ ${reg ? reg.status : ''} ${JSON.stringify(reg.body).slice(0, 120)}`);
    const login = await page.evaluate(async ({ u, p }) => {
      const r = await fetch('/api/auth/login/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, { u: testUser, p: testPass });
    report('8b. Login API', login.status === 200, `POST /api/auth/login/ ${login.status}`);
    const access = login.body && (login.body.access || (login.body.tokens && login.body.tokens.access));
    console.log('login detalles:', JSON.stringify(login.body).slice(0, 300));
    // Storage una sola vez via /me con Authorization manual para owner-verified
    // Diseño: JWTs en localStorage Interceptor: escribir llaves y navegar
    if (access) {
      await page.evaluate((tok) => {
        window.localStorage.setItem('chemistry-apps.access-token', typeof tok === 'string' ? tok : JSON.stringify(tok));
      }, typeof access === 'string' ? access : ' paranoia');
    }
    // si login devuelve tokens array object, guardamos tal cual
    console.log('login body keys: ', Object.keys(login.body || {}));
    // setear access token como lo espera interceptor: probablemente string
    const tokAccess = (login.body && (login.body.access_token || login.body.access)) || (login.body && login.body.tokens && login.body.tokens.access) || (login.body && login.body.token);
    console.log('token kinds:', typeof tokAccess);
    // Ahora naveguemos con JS localStorage k
    if (tokAccess) {
      await page.evaluate((tok) => window.localStorage.setItem('chemistry-apps.access-token', tok), String(tokAccess));
      const refresh = (login.body && (login.body.refresh_token || login.body.refresh)) || (login.body && login.body.tokens && login.body.tokens.refresh);
      if (refresh) await page.evaluate((t) => window.localStorage.setItem('chemistry-apps.refresh-token', t), String(refresh));
    }
    // Use the UI to login properly (set cookie/token state in signals)
    await gotoApp(page, '/login');
    await page.waitForSelector('.login-form input[name=username]', { timeout: 30000 });
    await page.locator('.login-form input[name=username]').fill(testUser);
    await page.locator('.login-form input[name=password]').fill(testPass);
    await page.locator('.login-form button[type=submit]').click();
    const authOk = await page.waitForSelector('.session-avatar', { timeout: 45000 }).then(() => true).catch(() => false);
    report('8b2. Login UI completo', authOk, `user=${testUser}`);
    await shot(page, '08b-login-a');
    // 8c tunnel POST via page auth context
    await gotoApp(page, '/tunnel');
    const run = await page.waitForFunction(() => { const b = document.querySelector('.tunnel-shell .entry-panel .btn-primary'); return b; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    // fuerza click con evaluate y espera respuesta
    const postBefore = api.filter(c => c.method === 'POST' && /^\/api\/tunnel\/jobs\//.test(c.url)).length;
    await page.evaluate(() => { const b = document.querySelector('.tunnel-shell .entry-panel .btn-primary'); b && b.click(); });
    try { await page.waitForSelector('.tunnel-shell .output-block', { timeout: 180000, state: 'visible' }); } catch (e) { /* noop */ }
    const postA = api.filter(c => c.method === 'POST' && /^\/api\/tunnel\/jobs\//.test(c.url));
    report('8c. Autenticado → POST /api/tunnel/jobs/ 201', postA.some(c => c.status === 201), `${JSON.stringify(postA.map(c => c.status + ' ' + c.url.slice(0, 40)).slice(0, 3))}`);
    await shot(page, '08c-tunnel-a');
    const raw = await page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.tunnel-effect');
    let jobId = null; try { jobId = JSON.parse(raw)[0].jobId; } catch (e) { }
    // monitor
    await gotoApp(page, '/jobs');
    try { await page.waitForSelector('.job-card, .empty-state', { timeout: 30000 }); } catch (e) { }
    const found = jobId ? await page.waitForFunction((j) => (document.body.innerText || '').includes(j), jobId, { timeout: 30000 }).then(() => true).catch(() => false) : false;
    report('8d. Monitor de jobs lista el job', found, `jobId=${jobId} jobCards=${await page.locator('.job-card').count()}`);
    await shot(page, '08d-monitor-a');
    // logout
    const btnLogout = await page.locator('.session-button').count();
    if (btnLogout) {
      await page.locator('.session-button').click();
      const gone = await page.waitForFunction(() => window.localStorage.getItem('chemistry-apps.access-token') === null, null, { timeout: 25000 }).then(() => true).catch(() => false);
      const signInLink = await page.evaluate(() => (document.body.innerText || '').toLowerCase().includes('sign in'));
      report('8e. Sign out → modo invitado', gone && signInLink, `tokenRemoved=${gone} signInLink=${signInLink}`);
      await shot(page, '08e-logout-a');
    } else defect('S2', 'No hay session-button tras auth', '');
  } finally {
    await browser.close();
    console.log(`PASS ${results.filter(r => r.ok).length}/${results.length}`);
    defects.forEach(d => console.log(`  [${d.sev}] ${d.d} :: ${d.r.slice(0, 240)}`));
    fs.writeFileSync('/tmp/opencode/agalano2-final-a.json', JSON.stringify({ results, defects }, null, 2));
  }
})();
