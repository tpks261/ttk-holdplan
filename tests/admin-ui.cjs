// Run with Node and Playwright installed. All requests are fulfilled with isolated fixtures.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [], calls = []; let failSave = false;
    page.on('pageerror', e => errors.push(e.message));
    const fixture = () => ({ ok: true, players: [{ n: 'Alma Test', t: 2, age: 10, level: 'Let øvet', h: [], dw: ['man-15:00–16:00','tir-15:00–16:00'], note: 'Mandag og tirsdag' }, { n: 'Emil Test', t: 1, h: [1], dw: [], level: 'Øvet' }, { n: 'Freja Test', t: 1, birthdate: '2015-01-01', h: [4], dw: [], note: '<img src=x onerror=alert(1)>' }], assignments: { 'Alma Test': '1', 'Emil Test': '1', 'Freja Test': '' }, capabilities: { adminSettings: true, assignmentValidation: true, birthdateImport: true }, adminSettings: { version: 0, holds: {} }, swapRequests: [], extraHolds: [] });
    const data = { winter: fixture(), summer: fixture() };
    data.summer.players = [{ n: 'Sommer Test', t: 1, h: [1] }]; data.summer.assignments = { 'Sommer Test': '1' };
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { signedIn: true, email: 'test@example.invalid' } });
      if (url.pathname === '/api/admin/backend') {
        const body = route.request().postDataJSON(); calls.push(body);
        if (body.type === 'load') return route.fulfill({ json: { ...data[body.season], season: body.season } });
        if (failSave) return route.fulfill({ json: { ok: false, error: 'Test save failure' } });
        if (body.type === 'save') data[body.season].assignments[body.name] = body.holds;
        if (body.type === 'importBirthdates') body.updates.forEach(update => { const player = data[body.season].players.find(p => p.n === update.name); player.birthdate = update.birthdate; });
        if (body.type === 'saveAdminSettings') { data[body.season].adminSettings.holds[body.holdId] = { court: body.court, capacity: body.capacity }; data[body.season].adminSettings.version++; }
        return route.fulfill({ json: { ok: true } });
      }
      const file = path.join(root, url.pathname === '/admin' ? 'admin-app.html' : url.pathname);
      if (!file.startsWith(root) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      await route.fulfill({ path: file, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/html' });
    });
    await page.goto('http://ttk.test/admin');
    await page.getByRole('heading', { name: 'Holdbytteanmodninger · 0', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Mangler tildeling: 2', exact: true }).click();
    assert.equal(await page.locator('#player-list .player-item').count(), 2);
    assert.match(await page.locator('[data-player="Freja Test"]').first().innerText(), new RegExp(String(new Date().getFullYear() - 2015) + ' år'));
    assert.equal(await page.locator('[data-assign="4"]').isVisible(), true); // Tuesday wish maps to winter, not summer.
    await page.locator('#manual-hold').fill('4');
    await page.locator('#manual-assignment').getByRole('button', { name: 'Tildel', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('Tildeling gemt'));
    assert.equal(data.winter.assignments['Alma Test'], '1,4');
    assert.equal(data.summer.assignments['Sommer Test'], '1');
    await page.locator('#season').selectOption('summer');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Spillere: 1', exact: true }).click();
    assert.match(await page.locator('#player-list').innerText(), /Sommer Test/);
    assert.equal(calls.filter(c => c.type !== 'load').length, 1); // Season changes only load.
    await page.locator('#season').selectOption('winter');
    await page.getByRole('button', { name: 'Baner og kapacitet', exact: true }).click();
    const form = page.locator('[data-settings="1"]');
    await form.locator('[name="capacity"]').fill('1');
    await form.locator('[name="court"]').fill('Lyngby · bane 2');
    await form.getByRole('button', { name: 'Gem', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('Bane og kapacitet gemt'));
    assert.match(await page.locator('[data-settings="1"]').innerText(), /Over kapacitet/);
    assert.equal(data.winter.assignments['Alma Test'], '1,4');
    assert.deepEqual(data.summer.adminSettings.holds, {});
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('button', { name: 'Spillere: 3', exact: true }).click();
    await page.locator('[data-player="Freja Test"]').first().click();
    assert.equal(await page.locator('.work-main img').count(), 0);
    failSave = true;
    await page.locator('[data-assign="4"]').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('Test save failure'));
    assert.equal(data.winter.assignments['Freja Test'], '');
    assert.match(await page.locator('#workspace').innerText(), /ikke indlæst/);
    failSave = false;
    await page.getByRole('button', { name: 'Genindlæs', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('spillere hentet'));
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Horizontal overflow at ' + width);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.screenshot({ path: process.env.ADMIN_SCREENSHOT || '/tmp/ttk-admin-tested.png', fullPage: true });
    await page.getByRole('button', { name: 'Upload CSV', exact: true }).click();
    await page.locator('#birthdate-files').setInputFiles([
      {name:'første.csv',mimeType:'text/csv',buffer:Buffer.from('Navn;Født\nEmil Test;12-10-2011','latin1')},
      {name:'anden.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Birthdate\nAlma Test,10.10.2014\nUkendt,01.01.2015','utf8')}
    ]);
    await page.waitForFunction(() => document.querySelector('#birthdate-preview').textContent.includes('2 tomme fødselsdatoer udfyldes'));
    assert.match(await page.locator('#birthdate-preview').innerText(), /Ukendt/);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#import-birthdates').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('Fødselsdatoer importeret'));
    assert.equal(data.winter.players.find(p => p.n === 'Emil Test').birthdate, '12.10.2011');
    assert.equal(data.summer.players[0].birthdate, undefined);
    assert.equal(data.winter.assignments['Alma Test'], '1,4');
    assert.deepEqual(data.winter.players.find(p => p.n === 'Alma Test').dw, ['man-15:00–16:00','tir-15:00–16:00']);
    delete data.winter.capabilities;
    await page.getByRole('button', { name: 'Genindlæs', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('spillere hentet'));
    await page.getByRole('button', { name: 'Baner og kapacitet', exact: true }).click();
    assert.match(await page.locator('#workspace').innerText(), /Apps Script-version først aktiveres/);
    assert.equal(await page.locator('[data-settings="1"] button').isDisabled(), true);
    await page.getByRole('button', { name: 'Upload CSV', exact: true }).click();
    await page.locator('#csv-file').setInputFiles({name:'dansk.csv',mimeType:'text/csv',buffer:Buffer.from('Navn;Meddelelse\nÆgir Øster;Ønsker træning på torsdag','latin1')});
    await page.locator('#csv-preview').getByText('Ægir Øster', {exact:true}).waitFor();
    await page.locator('#csv-file').setInputFiles({name:'opdater.csv',mimeType:'text/csv',buffer:Buffer.from('Navn;Meddelelse\nAlma Test;Tirsdag 15-16','utf8')});
    await page.waitForFunction(() => document.querySelector('#csv-preview').textContent.includes('1 springes over'));
    await page.locator('#csv-mode').selectOption('update');
    assert.match(await page.locator('#csv-preview').innerText(), /1 opdateres/);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#import').click();
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('CSV importeret'));
    assert.equal(calls.findLast(c => c.type === 'importCSV').updateExisting, true);
    assert.equal(data.winter.assignments['Alma Test'], '1,4');
    assert.deepEqual(errors, []);
    console.log('PASS: dashboard filtering, wishes, scoped saves, season isolation, settings, overcapacity, escaping, save errors and responsive layout.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
