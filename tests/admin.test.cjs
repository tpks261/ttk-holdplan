const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const M = require('../admin-assets/model');
const schedules = require('../admin-assets/default-schedules.json');

test('CSV handles comma, semicolon, BOM, quoted multiline fields and existing names', () => {
  for (const separator of [',', ';', '\t']) {
    const csv = '\uFEFFNavn' + separator + 'Meddelelse\r\n"Ny Spiller"' + separator + '"Tirsdag, tak\n15-16"\r\nEksisterende' + separator + 'Bevares';
    const prepared = M.newPlayersCsv(csv, [' eksisterende ']);
    assert.equal(prepared.added, 1); assert.equal(prepared.skipped, 1);
    const rows = M.parseCsv(prepared.csv);
    assert.equal(rows.data[0][1], 'Tirsdag, tak\n15-16');
  }
  assert.throws(() => M.parseCsv('Navn;Timer\nA;1\nA;2'), /flere gange/);
  assert.throws(() => M.parseCsv('Navn;Timer\nA;1;2'), /kolonner/);
});

test('wishes map to season schedules, completion and mismatch remain separate', () => {
  const p = { h: [], dw: ['tir-17:00–18:00'], a: ['1'] };
  assert.deepEqual(M.wishIds(p, schedules.winter), ['6', '13']);
  assert.deepEqual(M.wishIds(p, schedules.summer), ['16', '17', '18']);
  assert.equal(M.outsideWishes(p, schedules.winter), true);
  assert.equal(M.outsideWishes({ ...p, a: ['13'] }, schedules.winter), false);
  assert.equal(M.outsideWishes({ h: [1], a: ['2'] }, schedules.winter), true);
});

test('assignment key preserves existing name and unknown holds', () => {
  assert.deepEqual(M.assignmentFor('Alma', { ' ALMA ': '1,99.1' }), { key: ' ALMA ', holds: ['1', '99.1'] });
  assert.throws(() => M.assignmentFor('Alma', { ' ALMA ': '1', alma: '2' }), /Flere/);
});

function scriptHarness() {
  const sheets = {}, properties = { TTK_BACKEND_TOKEN: 'test-token', unrelated: 'preserve' };
  function sheet(name, initial) {
    const rows = structuredClone(initial);
    const item = {
      getDataRange: () => ({ getValues: () => structuredClone(rows) }),
      getLastColumn: () => Math.max(...rows.map(r => r.length), 0),
      getLastRow: () => rows.length,
      appendRow: row => rows.push([...row]),
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
        setValues: values => values.forEach((row, i) => row.forEach((value, j) => { rows[r - 1 + i] ||= []; rows[r - 1 + i][c - 1 + j] = value; })),
        setValue: value => { rows[r - 1] ||= []; rows[r - 1][c - 1] = value; }
      }), rows
    };
    sheets[name] = item; return item;
  }
  for (const prefix of ['', 'Winter']) {
    sheet(prefix + 'Players', [['Name','Timer','Price','HoldWishes','DayTimeWishes','Unplaced','Note','Birthdate','Level','Age'], ['Alma', 2, 900, '', 'man-15:00–16:00', 'FALSE', 'Keep note', '', 'Øvet', 10]]);
    sheet(prefix + 'Assignments', [['Name','Holds'], ['Alma', '1']]);
    sheet(prefix + 'ExtraHolds', [['Hold','Active']]);
    sheet(prefix + 'SwapRequests', [['Id','Timestamp','Name','FromHold','ToHold','Status','DecidedAt']]);
  }
  let locked = false;
  const context = vm.createContext({ console, SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => sheets[name], insertSheet: name => sheet(name, []), getName: () => 'Test', getUrl: () => 'test://sheet' }) }, PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null, setProperty: (key, value) => { properties[key] = value; } }) }, LockService: { getScriptLock: () => ({ waitLock: () => { assert.equal(locked, false); locked = true; }, releaseLock: () => { locked = false; } }) }, Utilities: { parseCsv: M.parseRows }, ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) } });
  vm.runInContext(fs.readFileSync(require.resolve('../apps-script'), 'utf8'), context);
  return { context, sheets, properties, snapshot: () => JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k, s]) => [k, s.rows]))), post: payload => context.doPost({ postData: { contents: JSON.stringify({ season: 'winter', token: 'test-token', ...payload }) } }) };
}

test('loading, changing season and saving settings leave player data untouched', () => {
  const h = scriptHarness(), before = h.snapshot();
  assert.equal(h.post({ type: 'load' }).capabilities.adminSettings, true);
  assert.equal(h.post({ type: 'load', season: 'summer' }).ok, true);
  assert.equal(h.snapshot(), before);
  assert.equal(h.post({ type: 'saveAdminSettings', holdId: '1', capacity: 1, court: 'Lyngby bane 2', expectedVersion: 0 }).ok, true);
  assert.equal(h.snapshot(), before); assert.equal(h.properties.unrelated, 'preserve');
  assert.deepEqual(h.post({ type: 'load', season: 'summer' }).adminSettings, { version: 0, holds: {} });
  assert.equal(h.post({ type: 'saveAdminSettings', holdId: '1', capacity: 3, court: 'Other', expectedVersion: 0 }).ok, false);
  assert.equal(h.post({ type: 'saveAdminSettings', holdId: '2', capacity: 3, court: 'Other', expectedVersion: 1, token: 'wrong' }).ok, false);
});

test('preserving CSV import never overwrites existing players, wishes or assignments', () => {
  const h = scriptHarness(), summer = structuredClone(h.sheets.Players.rows), player = structuredClone(h.sheets.WinterPlayers.rows[1]), assignments = structuredClone(h.sheets.WinterAssignments.rows);
  const result = h.post({ type: 'importCSV', preserveExisting: true, data: 'Navn,Timer,Meddelelse\nAlma,7,Overwrite\nNy spiller,1,Tirsdag 15-16' });
  assert.equal(result.ok, true); assert.equal(result.count, 1);
  assert.deepEqual(h.sheets.WinterPlayers.rows[1], player);
  assert.deepEqual(h.sheets.WinterAssignments.rows, assignments);
  assert.deepEqual(h.sheets.Players.rows, summer);
});

test('assignment saves detect conflicts, full holds and preserve the other season', () => {
  const h = scriptHarness(), summer = structuredClone(h.sheets.Assignments.rows);
  assert.equal(h.post({ type: 'save', name: 'Alma', holds: '2', expectedHolds: '3' }).ok, false);
  assert.equal(h.post({ type: 'save', name: 'Alma', holds: '1,99', expectedHolds: '1' }).ok, false);
  h.post({ type: 'saveAdminSettings', holdId: '2', capacity: 1, court: 'Court', expectedVersion: 0 });
  h.sheets.WinterAssignments.appendRow(['Other', '2']);
  assert.equal(h.post({ type: 'save', name: 'Alma', holds: '1,2', expectedHolds: '1' }).ok, false);
  assert.equal(h.post({ type: 'save', name: 'Alma', holds: '1,3', expectedHolds: '1' }).ok, true);
  assert.equal(h.sheets.WinterAssignments.rows[1][1], '1,3');
  assert.deepEqual(h.sheets.Assignments.rows, summer);
});

test('Vercel proxy scopes reads and only forwards new CSV rows to legacy backend', async () => {
  const calls = [];
  const context = vm.createContext({ Buffer, Set, console, module: { exports: {} }, require: name => name.includes('auth') ? { requireAdmin: () => ({ email: 'admin@test' }), requiredEnv: () => 'test' } : name.includes('model') ? M : schedules,
    fetch: async (_, opts) => { const body = JSON.parse(opts.body); calls.push(body); const result = body.type === 'load' ? { ok: true, season: body.season, players: [{ n: 'Alma', t: 2 }], assignments: { Alma: '1' } } : { ok: true, count: 1 }; return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => result, text: async () => JSON.stringify(result) }; } });
  vm.runInContext(fs.readFileSync(require.resolve('../api/admin/backend'), 'utf8'), context);
  async function request(body) { const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST'; const res = { setHeader() {}, end(text) { this.body = JSON.parse(text); } }; await context.module.exports(req, res); return res; }
  assert.equal((await request({ type: 'importCSV', season: 'winter', data: 'Navn,Timer\nAlma,7\nNy,1' })).body.ok, true);
  assert.equal(calls.length, 2); assert.equal(calls[0].season, 'winter'); assert.equal(calls[1].season, 'winter');
  assert.equal(M.parseCsv(calls[1].data).data[0][0], 'Ny');
  const before = calls.length;
  assert.equal((await request({ type: 'load', season: 'invalid' })).statusCode, 500);
  assert.equal(calls.length, before);
  assert.equal((await request({ type: 'saveAdminSettings', season: 'winter' })).body.ok, false);
});

test('swap approval respects winter capacity and rejects stale requests without touching assignments', () => {
  const h = scriptHarness();
  h.sheets.WinterSwapRequests.appendRow(['swap1', '', 'Alma', '1', '2', 'pending', '']);
  for (let i = 0; i < 4; i++) h.sheets.WinterAssignments.appendRow(['Other' + i, '2']);
  const before = structuredClone(h.sheets.WinterAssignments.rows);
  assert.equal(h.post({ type: 'reviewSwap', id: 'swap1', decision: 'approved' }).ok, false);
  assert.deepEqual(h.sheets.WinterAssignments.rows, before);
  h.sheets.WinterSwapRequests.appendRow(['swap2', '', 'Alma', '3', '4', 'pending', '']);
  assert.equal(h.post({ type: 'reviewSwap', id: 'swap2', decision: 'approved' }).ok, false);
  assert.deepEqual(h.sheets.WinterAssignments.rows, before);
});


test('summer-style export groups assigned players by hold and lists missing players separately', () => {
  const text = M.exportList([{n:'Ørn',a:[]},{n:'Åse',a:['4']},{n:'Ægir',a:['1']}], 'Vinter', '29.9.2026');
  assert.ok(text.indexOf('Ægir') < text.indexOf('Åse'));
  assert.match(text, /IKKE TILDELT ENDNU \(1 stk\)/);
  assert.equal(M.formatWish('tir-15:00–16:00'), 'Tirsdag · 15:00–16:00');
});


test('extra holds extend the base hold like summer without rewriting existing assignments', () => {
  const h = scriptHarness();
  h.sheets.WinterExtraHolds.appendRow(['1.1', 'TRUE']);
  for (let i=0;i<3;i++) h.sheets.WinterAssignments.appendRow(['Other'+i, '1']);
  h.sheets.WinterPlayers.appendRow(['New',1]);
  const before = structuredClone(h.sheets.WinterAssignments.rows);
  assert.equal(h.post({type:'save',name:'New',holds:'1',expectedHolds:''}).ok,true);
  assert.deepEqual(h.sheets.WinterAssignments.rows.slice(0,before.length),before);
  assert.equal(h.post({type:'toggleExtraHold',hold:'1.1',active:false}).ok,false);
  assert.equal(h.sheets.WinterExtraHolds.rows[1][1],'TRUE');
  const grouped=M.groupedSchedule([{id:'1',capacity:4,court:'A'},{id:'1.1',capacity:4,court:'B'}]);
  assert.equal(grouped.length,1);assert.equal(grouped[0].capacity,8);
  assert.equal(M.groupCount({A:'1',B:'1.1',C:'1,1.1'},'1'),3);
});


test('Danish CSV letters survive UTF-8, Windows-1252 and UTF-16; damaged names cannot create duplicate players', () => {
  const text = 'Navn;Meddelelse\nÆgir Øster Åse;Ønsker træning på torsdag';
  assert.equal(M.decodeCsv(Buffer.from(text,'utf8')),text);
  assert.equal(M.decodeCsv(Buffer.from(text,'latin1')),text);
  assert.equal(M.decodeCsv(Buffer.concat([Buffer.from([255,254]),Buffer.from(text,'utf16le')])),text);
  assert.throws(()=>M.decodeCsv(Buffer.from('Navn\nBj�rn','utf8')),/beskadigede/);
  assert.throws(()=>M.newPlayersCsv('Navn;Timer\nBjørn;1',['Bj�rn']),/dublet/);
  assert.equal(M.newPlayersCsv('Navn;Timer\nBjørn;1',['Anders']).added,1);
});
