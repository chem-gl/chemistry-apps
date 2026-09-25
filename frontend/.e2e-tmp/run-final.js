// FINAL: easy-rate + smileit UI + cuenta (run único, mínimo estricto aparate).
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const BASE = 'https://apps.agalano.com';
const results = []; const defects = [];
function report(n, ok, ev) { results.push({ name: n, ok, ev }); console.log(`${ok ? 'PASS' : 'FAIL'} | ${n}\n    ${ev}`); }
function defect(sev, d, r) { defects.push({ sev, d, r: String(r) }); console.log(`DEFECT[${sev}] ${d} :: ${String(r).slice(0, 240)}`); }
async function shot(page, n) { try { return await page.screenshot({ path: `/tmp/opencode/agalano2-${n}.png` }); } catch (e) { return null; } }
async function makePage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  const api = []; const apiFail = []; const consoleErrors = [];
  page.on('response', r => { try { const u = r.url(); if (u.includes('/api/')) { const c = { method: r.request().method(), url: u.replace(BASE, ''), status: r.status() }; api.push(c); if (c.status >= 400) apiFail.push(c); } } catch (e) { } });
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 220)); });
  return { ctx, page, api, apiFail, consoleErrors };
}
async function gotoApp(t, r) { await t.page.goto(`${BASE}${r}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); try { await t.page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { } }
function aSum(api) { const by = {}; for (const c of api) by[c.status] = (by[c.status] || 0) + 1; return `api ${api.length} ${JSON.stringify(by)}`; }

const DIR = '/tmp/opencode'; const MIN_LOG = path.join(DIR, 'min0.log'); const TS_LOG = path.join(DIR, 'ts1.log');
fs.writeFileSync(MIN_LOG, [' Initial command:', ' ga09 min.log', ' #p opt freq 6-311+G(d,p)', ' ---------------', ' MIN', ' ---------------', ' Charge =  1 Multiplicity = 2', ' SCF Done:  E(RM052X) =  -688.001234  A.U. after   18 cycles', ' Sum of electronic and zero-point Energies= -687.870111', ' Sum of electronic and thermal Enthalpies= -687.847222', ' Sum of electronic and thermal Free Energies= -687.879333', ' Temperature  298.150 Kelvin.  Pressure   1.00000 Atm.', ' 0 imaginary frequencies (negative Signs)', ' Frequencies --  1200.1234  900.5432  650.1000', ' Normal termination of Gaussian 09 at Fri Jan 28 03:25:33 2022.', ''].join('\n'));
fs.writeFileSync(TS_LOG, [' Initial command:', ' ga09 ts.log', ' %chk=ts.chk', ' #p opt freq 6-311+G(d,p)', ' ---------------', ' TS', ' ---------------', ' Charge =  1 Multiplicity = 2', ' SCF Done:  E(RM052X) =  -687.542319  A.U. after   18 cycles', ' Sum of electronic and zero-point Energies= -687.412345', ' Sum of electronic and thermal Enthalpies= -687.389012', ' Sum of electronic and thermal Free Energies= -687.421567', ' Temperature  298.150 Kelvin.  Pressure   1.00000 Atm.', ' 1 imaginary frequencies (negative Signs)', ' Frequencies --  -1450.5432', ' Frequencies --  950.5432  900.1234', ' Normal termination of Gaussian 09 at Fri Jan 28 03:25:33 2022.', ''].join('\n'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ts = Date.now();
  const testEmail = `verify2-${ts}@example.com`;
  const testUser = `verify2${String(ts).slice(-8)}`;
  const testPass = 'Test1234!e2e';
  try {
    // ── EASY-RATE ──
    const te = await makePage(browser);
    try {
      await gotoApp(te, '/easy-rate');
      await te.page.waitForSelector('.easy-rate-shell .entry-panel input[type=file]', { timeout: 30000 });
      const fin = te.page.locator('.easy-rate-shell .entry-panel input[type=file]');
      const nF = await fin.count();
      for (let i = 0; i < nF; i++) await fin.nth(i).setInputFiles(i === 0 ? TS_LOG : MIN_LOG);
      await te.page.waitForSelector('.easy-rate-shell .inspection-card .preview-grid', { timeout: 90000 });
      const runOk = await te.page.waitForFunction(() => { const b = document.querySelector('.easy-rate-shell .entry-panel .btn-primary'); return b && !b.disabled; }, null, { timeout: 60000 }).then(() => true).catch(() => false);
      if (!runOk) defect('S1', 'Easy-rate Run deshabilitado', 'roleErrs=' + JSON.stringify((await te.page.locator('.inspection-error').allTextContents()).slice(0, 3)));
      else {
        const pc = [];
        const iv = setInterval(() => { te.page.evaluate(() => Array.from(document.querySelectorAll('app-job-progress-card, .status-message')).map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()).join('|')).then(x => { if (x && x.trim() && !pc.includes(x)) pc.push(x); }).catch(() => { }); }, 400);
        await te.page.locator('.easy-rate-shell .entry-panel .btn-primary').click();
        try { await te.page.waitForSelector('.easy-rate-shell .kv-value', { timeout: 300000, state: 'visible' }); } catch (e) { /* */ }
        clearInterval(iv);
        const kv = await te.page.locator('.easy-rate-shell .kv-value').allTextContents();
        report('3c. Easy-rate invitado: 5 uploads + inspect + calculo TST', kv.length > 0 && !te.apiFail.some(c => c.status === 401),
          `${aSum(te.api)} kv=${JSON.stringify(kv.map(v => v.replace(/\s+/g, ' ').trim()).slice(0, 4))} progress=${JSON.stringify(pc.slice(0, 3))}`);
        await shot(te.page, '03-easyrate-final');
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
          defect('S1', 'Easy-rate dispatch no terminó en invitado', `${aSum(te.api)} apiFail=${JSON.stringify(te.apiFail.slice(0, 5))} progress=${pc.join('|').slice(0, 200)}`);
        }
      }
    } catch (e) { await shot(te.page, '3c-easyrate-final'); report('3c. Easy-rate', false, 'EXC ' + e.message.slice(0, 200)); defect('S1', 'Easy-rate exc final', e.message.slice(0, 240)); }
    if (te.apiFail.length) console.log('   apiFail: ' + te.apiFail.map(c => c.status + ' ' + c.url).slice(0, 6).join(' ; '));
    if (te.consoleErrors.length) defect('S2', 'consola easy-rate', te.consoleErrors.slice(0, 3).join(' || '));
    await te.ctx.close();

    // ── SMILEIT UI ──
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
          console.log(`   smileit: addButtons=${nAdd} added=${added} uncovered=${uncovered} runReady=${runReady}`);
          await shot(tsm.page, '06-smileit-final-sel');
          if (runReady) {
            const rs = tsm.page.locator('.generation-fieldset input[type=number]').first();
            if (await rs.isEnabled()) await rs.fill('2').catch(() => { });
            await tsm.page.locator('.generation-fieldset .btn-primary').click();
            try { await tsm.page.waitForSelector('.execution-summary-value', { timeout: 300000, state: 'visible' }); } catch (e) { /* */ }
            const sv = await tsm.page.locator('.execution-summary-value').allTextContents();
            totalGen = parseInt((sv[0] || '0').replace(/[^0-9]/g, ''), 10) || 0;
            await shot(tsm.page, '06-smileit-final-res');
          }
        } catch (e) { console.log('   smileit exc ' + e.message.slice(0, 150)); await shot(tsm.page, '06-smileit-final-exc'); }
      }
      if (totalGen > 0) {
        report('6/3g. Smile-it UI no-canónica → derivados > 0', true, `${aSum(tsm.api)} inspect=${inspected} r=2 totalGenerated=${totalGen}`);
        const raw = await tsm.page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.smileit');
        report('4g. localStorage smileit registrado', !!raw && JSON.parse(raw).length > 0, `records=${raw ? JSON.parse(raw).length : 0}`);
        await tsm.page.reload({ waitUntil: 'domcontentloaded' });
        try { await tsm.page.waitForLoadState('networkidle', { timeout: 12000 }); } catch (e) { }
        const after = await tsm.page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.smileit');
        report('4g2. localStorage smileit persiste tras reload', !!after, `bytes=${after ? after.length : 0}`);
      } else {
        report('6/3g. Smile-it UI no-canónica → derivados', false, `inspect=${inspected} totalGen=${totalGen}`);
        defect('S2', 'Smile-it flujo UI invitado no genera derivados (API sí: 3)', `totalGen=${totalGen}`);
      }
    } catch (e) { await shot(tsm.page, '3g-smileit-final'); report('3g/6. Smile-it UI', false, 'EXC ' + e.message.slice(0, 200)); }
    if (tsm.apiFail.length) console.log('   (smileit apiFail: ' + tsm.apiFail.map(c => c.status + ' ' + c.url).slice(0, 8).join(' ; ') + ')');
    console.log(`   (smileit /api/jobs/ literales: ${tsm.api.filter(c => /\/api\/jobs\//.test(c.url)).length})`);
    if (tsm.consoleErrors.length) defect('S2', 'consola smileit', tsm.consoleErrors.slice(0, 3).join(' || '));
    await tsm.ctx.close();

    // ── CUENTA ──
    const ta = await makePage(browser);
    try {
      await gotoApp(ta, '/login');
      await ta.page.waitForSelector('.login-form input[name=username]', { timeout: 30000 });
      // registra primero vía API directa (más determinista que UI)
      const reg = await ta.page.evaluate(async ({ u, e, p }) => {
        const r = await fetch('/api/auth/register/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, email: e, password: p }) });
        return { status: r.status, body: await r.json().catch(() => null) };
      }, { u: testUser, e: testEmail, p: testPass });
      const regOk = reg.status === 201;
      report('8a. Registro cuenta (API pública /api/auth/register/)', regOk, `${reg.status} ${JSON.stringify(reg.body).slice(0, 160)}`);
      if (!regOk) defect('S1', 'Registro no 201', `${reg.status} ${JSON.stringify(reg.body).slice(0, 250)}`);
      else {
        await ta.page.locator('.login-form input[name=username]').fill(testUser);
        await ta.page.locator('.login-form input[name=password]').fill(testPass);
        await ta.page.locator('.login-form button[type=submit]').click();
        const authOk = await ta.page.waitForSelector('.session-avatar', { timeout: 45000 }).then(() => true).catch(() => false);
        report('8b. Login con cuenta registrada', authOk, `user=${testUser} email=${testEmail} login=${JSON.stringify(ta.api.filter(c => /auth\/login/.test(c.url)).slice(0, 2).map(c => c.status))}`);
        await shot(ta.page, '08b-login-final');
        if (!authOk) defect('S1', 'Login de cuenta recién registrada falla', `user=${testUser}`);
        else {
          await gotoApp(ta, '/tunnel');
          await ta.page.waitForSelector('.tunnel-shell .entry-panel .btn-primary', { timeout: 30000 });
          await ta.page.locator('.tunnel-shell .entry-panel .btn-primary').click();
          try { await ta.page.waitForSelector('.tunnel-shell .output-block', { timeout: 180000, state: 'visible' }); } catch (e) { }
          const postA = ta.api.filter(c => c.method === 'POST' && /^\/api\/tunnel\/jobs\//.test(c.url));
          const okAuth = postA.some(c => c.status === 201);
          report('8c. Autenticado → job /api/tunnel/jobs/ 201', okAuth, `posts=${JSON.stringify(postA.slice(0, 2).map(c => c.status + ' ' + c.url.slice(0, 36)))}`);
          await shot(ta.page, '08c-tunnel-final');
          const raw = await ta.page.evaluate(k => window.localStorage.getItem(k), 'chemistry-apps.results.v1.tunnel-effect');
          let jobId = null; try { jobId = JSON.parse(raw)[0].jobId; } catch (e) { }
          await gotoApp(ta, '/jobs');
          try { await ta.page.waitForSelector('.job-card', { timeout: 30000 }); } catch (e) { }
          const found = jobId ? await ta.page.waitForFunction((j) => (document.body.innerText || '').includes(j), jobId, { timeout: 30000 }).then(() => true).catch(() => false) : false;
          report('8d. Monitor de jobs lista el job', found, `jobId=${jobId}`);
          await shot(ta.page, '08d-monitor-final');
          if (jobId && !found) defect('S2', 'Job no visible en monitor', `jobId=${jobId}`);
          await ta.page.locator('.session-button').click();
          const gone = await ta.page.waitForFunction(() => window.localStorage.getItem('chemistry-apps.access-token') === null, null, { timeout: 25000 }).then(() => true).catch(() => false);
          const navOk = await ta.page.evaluate(() => (document.body.innerText || '').toLowerCase().includes('sign in'));
          report('8e. Sign out → modo invitado', gone && navOk, `tokenRemoved=${gone} signInLink=${navOk}`);
          await shot(ta.page, '08e-logout-final');
          if (!gone) defect('S2', 'Sign out deja token', '');
        }
      }
    } catch (e) { await shot(ta.page, '8-final'); report('8. Cuenta', false, 'EXC ' + e.message.slice(0, 200)); defect('S1', 'Cuenta exc final', e.message.slice(0, 240)); }
    await ta.ctx.close();
  } finally {
    await browser.close();
    console.log('\n===== FINAL =====');
    console.log(`PASS ${results.filter(r => r.ok).length}/${results.length}`);
    results.forEach(r => console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.name}`));
    defects.forEach(d => console.log(`  [${d.sev}] ${d.d} :: ${d.r.slice(0, 240)}`));
    fs.writeFileSync('/tmp/opencode/agalano2-final.json', JSON.stringify({ results, defects }, null, 2));
  }
})();
