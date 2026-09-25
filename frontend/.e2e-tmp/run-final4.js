// FINAL C: espera límite público, luego easy-rate + smileit UI + cuenta tunnel completo.
const { chromium } = require('@playwright/test');
const fs = require('fs'); const path = require('path');
const BASE = 'https://apps.agalano.com';
const results = []; const defects = [];
const report = (n, ok, ev) => { results.push({ name: n, ok, ev }); console.log(`${ok ? 'PASS' : 'FAIL'} | ${n}\n    ${ev}`); };
const defect = (sev, d, r) => { defects.push({ sev, d, r: String(r) }); console.log(`DEFECT[${sev}] ${d} :: ${String(r).slice(0, 230)}`); };
const shot = (page, n) => page.screenshot({ path: `/tmp/opencode/agalano2-${n}.png` }).catch(() => null);
const gotoApp = async (page, r) => { await page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { } };
async function waitQuotaFree(maxMin = 45) {
  console.log('esperando cuota pública libre...');
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs(maxMin * 60000)) {
    try {
      const r = await fetch(`${BASE}/api/public/catalog/`);
      if (r.status === 200) { console.log('cuota liberada tras', Math.round((Date.now() - t0) / 1000), 's'); return true; }
      if (r.status !== 429) { console.log('catalog status', r.status); }
    } catch (e) { /* */ }
    await new Promise(re => setTimeout(re, 60000));
  }
  return false;
  function maxMs(ms) { return ms; }
  function maxMinutes() { return maxMs(1000); }
}
(function () { /* noop */ })();
// alias maxMs correcto luego
function maxMs(ms) { return ms; }

async function makePage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const api = []; const apiFail = []; const consoleErrors = [];
  page.on('response', r => { try { const u = r.url(); if (u.includes('/api/')) { const c = { method: r.request().method(), url: u.replace(BASE, ''), status: r.status() }; api.push(c); if (c.status >= 400) apiFail.push(c); } } catch (e) { } });
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 220)); });
  return { ctx, page, api, apiFail, consoleErrors };
}

// logs sintéticos
const MIN_LOG = '/tmp/opencode/min0.log';
const TS_LOG = '/tmp/opencode/ts1.log';
if (!fs.existsSync(MIN_LOG)) {
  fs.writeFileSync(MIN_LOG, [' Initial command:', ' #p opt freq 6-311+G(d,p)', ' MIN', ' Charge =  1 Multiplicity = 2', ' SCF Done:  E(RM052X) =  -688.001234  A.U. after   18 cycles', ' Sum of electronic and zero-point Energies= -687.870111', ' Sum of electronic and thermal Enthalpies= -687.847222', ' Sum of electronic and thermal Free Energies= -687.879333', ' Temperature  298.150 Kelvin.  Pressure   1.00000 Atm.', ' 0 imaginary frequencies (negative Signs)', ' Frequencies --  1200.1234  900.5432  650.1000', ' Normal termination of Gaussian 09 at Fri Jan 28 03:25:33 2022.', ''].join('\n'));
}
if (!fs.existsSync('/tmp/opencode/ts1.log')) {
  fs.writeFileSync('/tmp/opencode/ts1.log', [' Initial command:', ' %chk=ts.chk', ' #p opt freq 6-311+G(d,p)', ' TS', ' Charge =  1 Multiplicity = 2', ' SCF Done:  E(RM052X) =  -687.542319  A.U. after   18 cycles', ' Sum of electronic and zero-point Energies= -687.412345', ' Sum of electronic and thermal Enthalpies= -687.389012', ' Sum of electronic and thermal Free Energies= -687.421567', ' Temperature  298.150 Kelvin.  Pressure   1.00000 Atm.', ' 1 imaginary frequencies (negative Signs)', ' Frequencies --  -1450.5432', ' Frequencies --  950.5432  900.1234', ' Normal termination of Gaussian 09 at Fri Jan 28 03:25:33 2022.', ''].join('\n'));
}
function aSum(api) { const by = {}; for (const c of api) by[c.status] = (by[c.status] || 0) + 1; return `api ${api.length} ${JSON.stringify(by)}`; }

(async () => {
  await waitQuotaFree();
  const browser = await chromium.launch({ headless: true });
  try {
    // ═══ EASY-RATE ═══
    const te = await makePage(browser);
    try {
      await gotoApp(te, '/easy-rate');
      await te.page.waitForSelector('.easy-rate-shell .entry-panel input[type=file]', { timeout: 30000 });
      const fin = te.page.locator('.easy-rate-shell .entry-panel input[type=file]');
      const nF = await fin.count();
      for (let i = 0; i < nF; i++) await fin.nth(i).setInputFiles(i === 0 ? '/tmp/opencode/ts1.log' : MIN_LOG);
      await te.page.waitForSelector('.easy-rate-shell .inspection-card .preview-grid', { timeout: 90000 });
      const runOk = await te.page.waitForFunction(() => { const b = document.querySelector('.easy-rate-shell .entry-panel .btn-primary'); return b && !b.disabled; }, null, { timeout: 60000 }).then(() => true).catch(() => false);
      if (!runOk) defect('S1', 'Easy-rate Run deshabilitado', 'roleErrs=' + JSON.stringify((await te.page.locator('.inspection-error').allTextContents()).slice(0, 4)));
      else {
        const pc = [];
        const iv = setInterval(() => { te.page.evaluate(() => Array.from(document.querySelectorAll('app-job-progress-card, .status-message')).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()).join('|')).then(x => { if (x && x.trim() && !pc.includes(x)) pc.push(x); }).catch(() => { }); }, 400);
        await te.page.locator('.easy-rate-shell .entry-panel .btn-primary').click();
        try { await te.page.waitForSelector('.easy-rate-shell .kv-value', { timeout: 300000, state: 'visible' }); } catch (e) { }
        clearInterval(iv);
        const kv = await te.page.locator('.easy-rate-shell .kv-value').allTextContents();
        report('3c. Easy-rate invitado: 5 uploads + inspect + calculo TST', kv.length > 0 && !te.apiFail.some(c => c.status === 401),
          `${aSum(te.api)} kv=${JSON.stringify(kv.map(v => v.replace(/\s+/g, ' ').trim()).slice(0, 4))} progress=${JSON.stringify(pc.slice(0, 3))}`);
        await shot(te.page, '03-easyrate-final2');
        if (kv.length) {
          try {
            const dlp = te.page.waitForEvent('download', { timeout: 40000 });
            await te.page.locator('.export-row .btn-secondary').nth(0).click();
            const dl = await dlp; const p = `/tmp/opencode/agalano2-05-easyrate-csv-${dl.suggestedFilename()}`;
            await dl.saveAs(p); const sz = fs.statSync(p).size;
            report('5c. Easy-rate descarga CSV', sz > 50, `file=${dl.suggestedFilename()} ${sz}B path=${p}`);
          } catch (e) { report('5c. Easy-rate descarga CSV', false, 'err ' + e.message.slice(0, 160)); }
          try {
            const dlp = te.page.waitForEvent('download', { timeout: 40000 });
            await te.page.locator('.export-row .btn-secondary').nth(1).click();
            const dl = await dlp; const p = `/tmp/opencode/agalano2-05-easyrate-log-${dl.suggestedFilename()}`;
            await dl.saveAs(p); report('5c2. Easy-rate descarga LOG', true, `path=${p} ${fs.statSync(p).size}B`);
          } catch (e) { report('5c2. Easy-rate descarga LOG', false, 'err ' + e.message.slice(0, 160)); }
          const raw = await te.page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.easy-rate');
          let cnt = 0, jobId = null; try { const a = JSON.parse(raw); cnt = a.length; jobId = a[0].jobId; } catch (e) { }
          await te.page.reload({ waitUntil: 'domcontentloaded' });
          try { await te.page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { }
          const after = await te.page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.easy-rate');
          report('4c. localStorage easy-rate persiste tras reload', cnt > 0 && !!after && JSON.parse(after).some(x => x.jobId === jobId),
            `records=${cnt} jobId=${jobId} afterReload=${after ? after.length + 'B' : 'GONE'}`);
        } else {
          defect('S1', 'Easy-rate no completa en invitado', `${aSum(te.api)} apiFail=${JSON.stringify(te.apiFail.slice(0, 5))} progr=${pc.join('|').slice(0, 200)}`);
        }
      }
    } catch (e) { await shot(te.page, '3c-easyrate-final2'); report('3c. Easy-rate', false, 'EXC ' + e.message.slice(0, 200)); defect('S1', 'Easy-rate exc final', e.message.slice(0, 240)); }
    if (te.apiFail.length) console.log('   apiFail: ' + te.apiFail.map(c => c.status + ' ' + c.url).slice(0, 6).join(' ; '));
    if (te.consoleErrors.length) defect('S2', 'consola easy-rate final', te.consoleErrors.slice(0, 3).join(' || '));
    await te.ctx.close();

    // ═══ SMILEIT UI ═══
    const tsm = await makePage(browser);
    try {
      await gotoApp(tsm, '/smileit');
      await tsm.page.waitForSelector('app-principal-molecule-editor input', { timeout: 30000 });
      await tsm.page.fill('app-principal-molecule-editor input', 'c1(O)c(NCCC=C)c2c([nH]cc2)c([N+](=O)[O-])c1O');
      await tsm.page.locator('app-principal-molecule-editor .btn-secondary').nth(1).click();
      const inspected = await tsm.page.waitForSelector('.inspection-floating-panel .atom-grid .atom-chip', { timeout: 90000 }).then(() => true).catch(() => false);
      let totalGen = 0;
      if (inspected) {
        try {
          await tsm.page.locator('.inspection-floating-panel .atom-chip', { hasText: '#5' }).first().click();
          await tsm.page.locator('.inspection-floating-panel .atom-chip', { hasText: '#18' }).first().click();
          await tsm.page.locator('.add-block-btn').first().click();
          await tsm.page.waitForSelector('.block-card', { timeout: 10000 });
          await tsm.page.waitForTimeout(1500);
          const bc = tsm.page.locator('.block-card').first();
          const addBtns = bc.locator('button.catalog-add');
          const nAdd = await addBtns.count();
          let added = false;
          if (nAdd > 0) { await addBtns.nth(0).click(); added = true; }
          await tsm.page.waitForTimeout(1500);
          const uncovered = await tsm.page.locator('.atom-selection-sticky .warning-message').count();
          const runReady = await tsm.page.waitForFunction(() => { const b = document.querySelector('.generation-fieldset .btn-primary'); return b && !b.disabled; }, null, { timeout: 20000 }).then(() => true).catch(() => false);
          console.log(`   smileit: addBtns=${nAdd} added=${added} uncovered=${uncovered} runReady=${runReady}`);
          await shot(tsm.page, '06-smileit-final2-sel');
          if (runReady) {
            const rs = tsm.page.locator('.generation-fieldset input[type=number]').first();
            if (await rs.isEnabled()) await rs.fill('2').catch(() => { });
            await tsm.page.locator('.generation-fieldset .btn-primary').click();
            try { await tsm.page.waitForSelector('.execution-summary-value', { timeout: 300000, state: 'visible' }); } catch (e) { }
            const sv = await tsm.page.locator('.execution-summary-value').allTextContents();
            totalGen = parseInt((sv[0] || '0').replace(/[^0-9]/g, ''), 10) || 0;
            await shot(tsm.page, '06-smileit-final2-res');
          }
        } catch (e) { console.log('   smileit exc ' + e.message.slice(0, 150)); await shot(tsm.page, '06-smileit-final2-exc'); }
      }
      if (totalGen > 0) {
        report('6/3g. Smile-it UI no-canónica → derivados', true, `${aSum(tsm.api)} inspect=${inspected} r=2 totalGenerated=${totalGen}`);
        const raw = await tsm.page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.smileit');
        report('4g. localStorage smileit registrado', !!raw && JSON.parse(raw).length > 0, `records=${raw ? JSON.parse(raw).length : 0}`);
        await tsm.page.reload({ waitUntil: 'domcontentloaded' });
        try { await tsm.page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { }
        const after = await tsm.page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.smileit');
        report('4g2. localStorage smileit persiste', !!after, `bytes=${after ? after.length : 0}`);
      } else {
        report('6/3g. Smile-it UI no-canónica → derivados', false, `inspect=${inspected} totalGen=${totalGen}`);
        defect('S2', 'Smile-it UI invitado no genera derivados (API sí: 3)', `totalGen=${totalGen}`);
      }
    } catch (e) { await shot(tsm.page, '3g-smileit-final2'); report('3g/6. Smile-it UI', false, 'EXC ' + e.message.slice(0, 200)); }
    if (tsm.apiFail.length) console.log('   (smileit apiFail: ' + tsm.apiFail.map(c => c.status + ' ' + c.url).slice(0, 8).join(' ; ') + ')');
    console.log(`   (smileit /api/jobs/ literales: ${tsm.api.filter(c => /\/api\/jobs\//.test(c.url)).length})`);
    if (tsm.consoleErrors.length) defect('S2', 'consola smileit final', tsm.consoleErrors.slice(0, 3).join(' || '));
    await tsm.ctx.close();

    // ═══ CUENTA (register+login → tunnel run + monitor + signout) ═══
    const ts2 = Date.now();
    const testEmail = `verify2-${ts2}@example.com`;
    const testUser = `verify2${String(ts2).slice(-8)}`;
    const testPass = 'Test1234!e2e';
    const ta = await makePage(browser);
    try {
      await gotoApp(ta, '/apps');
      const reg = await fetch(`${BASE}/api/auth/register/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: testUser, email: testEmail, password: testPass }) });
      const regBody = await reg.json().catch(() => null);
      report('8a. Registro cuenta (API)', reg.status === 201, `POST /api/auth/register/ ${reg.status} ${JSON.stringify(regBody).slice(0, 140)}`);
      const login = await fetch(`${BASE}/api/auth/login/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: testUser, password: testPass }) });
      const loginBody = await login.json().catch(() => null);
      report('8b. Login (API)', login.status === 200, `POST /api/auth/login/ ${login.status} keys=${Object.keys(loginBody || {}).join(',')}`);
      const access = loginBody && loginBody.access; const refresh = loginBody && loginBody.refresh;
      if (access) await ta.page.evaluate(([a, r]) => { window.localStorage.setItem('chemistry-apps.access-token', String(a)); if (r) window.localStorage.setItem('chemistry-apps.refresh-token', String(r)); }, [access, refresh]);
      await gotoApp(ta, '/tunnel');
      const authOk = await ta.page.waitForSelector('.session-avatar', { timeout: 45000 }).then(() => true).catch(() => false);
      report('8b2. UI reconoce sesión', authOk, `user=${testUser}`);
      await shot(ta.page, '08b-login-final2');
      await ta.page.waitForFunction(() => { const b = document.querySelector('.tunnel-shell .entry-panel .btn-primary'); return !!b; }, null, { timeout: 30000 });
      const postBefore = ta.api.filter(c => c.method === 'POST').length;
      await ta.page.evaluate(() => { const b = document.querySelector('.tunnel-shell .entry-panel .btn-primary'); b && b.click(); });
      try { await ta.page.waitForSelector('.tunnel-shell .output-block', { timeout: 180000, state: 'visible' }); } catch (e) { }
      await shot(ta.page, '08c-tunnel-final2');
      const posts = ta.api.filter(c => c.method === 'POST' && /\/api\/tunnel\/jobs\//.test(c.url));
      report('8c. Autenticado → POST /api/tunnel/jobs/ 201', posts.some(c => c.status === 201), `posts=${JSON.stringify(posts.slice(0, 2).map(c => c.status + ' ' + c.url.slice(0, 44)))}`);
      if (!posts.some(c => c.status === 201)) defect('S1', 'Job autenticado sin 201', JSON.stringify(posts.slice(0, 5)) + ' totalPosts=' + ta.api.filter(c => c.method === 'POST').length);
      const raw = await ta.page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.tunnel-effect');
      let jobId = null; try { jobId = JSON.parse(raw)[0].jobId; } catch (e) { }
      await gotoApp(ta, '/jobs');
      try { await ta.page.waitForSelector('.job-card', { timeout: 30000 }); } catch (e) { }
      const found = jobId ? await ta.page.waitForFunction((j) => (document.body.innerText || '').includes(j), jobId, { timeout: 30000 }).then(() => true).catch(() => false) : false;
      report('8d. Monitor lista el job', found, `jobId=${jobId}`);
      await shot(ta.page, '08d-monitor-final2');
      if (jobId && !found) defect('S2', 'Job no visible en monitor', `jobId=${jobId}`);
      const logoutBtns = await ta.page.locator('.session-button').count();
      if (logoutBtns) {
        await ta.page.locator('.session-button').click();
        const gone = await ta.page.waitForFunction(() => window.localStorage.getItem('chemistry-apps.access-token') === null, null, { timeout: 25000 }).then(() => true).catch(() => false);
        const signIn = await ta.page.evaluate(() => (document.body.innerText || '').toLowerCase().includes('sign in'));
        report('8e. Sign out → invitado', gone && signIn, `tokenRemoved=${gone} signInLink=${signIn}`);
        await shot(ta.page, '08e-logout-final2');
        if (!gone) defect('S2', 'Sign out deja token', '');
      } else defect('S2', 'session-button ausente', '');
    } catch (e) { await shot(ta.page, '8-final2'); report('8. Cuenta', false, 'EXC ' + e.message.slice(0, 200)); defect('S1', 'Cuenta exc final2', e.message.slice(0, 240)); }
    if (ta.apiFail.length) console.log('   (cuenta apiFail: ' + ta.apiFail.map(c => c.status + ' ' + c.url).slice(0, 6).join(' ; ') + ')');
    await ta.ctx.close();
  } finally {
    await browser.close();
    console.log(`\nFINAL-C PASS ${results.filter(r => r.ok).length}/${results.length}`);
    results.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`));
    defects.forEach(d => console.log(`  [${d.sev}] ${d.d} :: ${d.r.slice(0, 230)}`));
    fs.writeFileSync('/tmp/opencode/agalano2-final-c.json', JSON.stringify({ results, defects }, null, 2));
  }
})();
