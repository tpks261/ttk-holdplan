const { requireAdmin, requiredEnv } = require('../_lib/auth');
const model = require('../../admin-assets/model');
const schedules = require('../../admin-assets/default-schedules.json');

const READ_ACTIONS = new Set(['load']);
const WRITE_ACTIONS = new Set([
  'addPlayer',
  'importCSV',
  'reviewSwap',
  'save',
  'saveLevel',
  'saveAdminSettings',
  'swapRequest',
  'toggleExtraHold'
]);

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function backend(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const session = requireAdmin(req, res);
  if (!session) return;

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'Use POST' }));
    return;
  }

  try {
    const payload = await readJsonBody(req);
    const type = String(payload.type || 'load');
    if (!['winter', 'summer'].includes(payload.season)) throw new Error('Vælg en gyldig sæson.');

    if (!READ_ACTIONS.has(type) && !WRITE_ACTIONS.has(type)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'Unsupported backend action' }));
      return;
    }

    const proxiedPayload = {
      ...payload,
      season: payload.season || 'winter',
      token: requiredEnv('TTK_BACKEND_TOKEN')
    };

    async function callBackend(body) {
      const response = await fetch(requiredEnv('TTK_APPS_SCRIPT_URL'), {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Backend-kald fejlede');
      return data;
    }

    // Validate against fresh data before a write. New Apps Script repeats this under a lock.
    if (['save', 'importCSV', 'addPlayer', 'saveAdminSettings', 'toggleExtraHold', 'reviewSwap'].includes(type)) {
      const current = await callBackend({ type: 'load', season: payload.season, token: proxiedPayload.token });
      if (!Array.isArray(current.players) || !current.assignments || (current.season && current.season !== payload.season)) throw new Error('Ugyldige sæsondata. Intet er ændret.');
      const configuredSchedule = schedules[payload.season].map(h => ({ ...h, ...(current.adminSettings?.holds?.[h.id] || {}) }));
      (current.extraHolds || []).forEach(value => {
        const id = String(value), parent = schedules[payload.season].find(h => h.id === model.base(id));
        if (parent && !configuredSchedule.some(h => h.id === id)) configuredSchedule.push({ ...parent, id, ...(current.adminSettings?.holds?.[id] || {}) });
      });
      const groupCapacity = id => model.groupedSchedule(configuredSchedule).find(h => h.id === model.base(id))?.capacity || 0;
      if (type === 'saveAdminSettings' && !current.capabilities?.adminSettings) throw new Error('Opdatér Apps Script før baner og kapacitet kan gemmes.');
      if (type === 'reviewSwap' && payload.decision === 'approved' && !current.capabilities?.assignmentValidation) throw new Error('Opdatér Apps Script før holdbytter kan godkendes med korrekt kapacitet.');
      if (type === 'toggleExtraHold') {
        if (!(current.extraHoldOptions || []).some(h => String(h.hold) === payload.hold)) throw new Error('Ekstraholdet findes ikke.');
        if (!payload.active && Object.values(current.assignments).some(v => model.holds(v).includes(payload.hold))) throw new Error('Flyt spillerne før ekstraholdet deaktiveres.');
        if (!payload.active && model.groupCount(current.assignments, payload.hold) > groupCapacity(payload.hold) - (configuredSchedule.find(h => h.id === payload.hold)?.capacity || 0)) throw new Error('Ekstraholdet kan ikke lukkes: grundholdet har brug for pladserne.');
      }
      if (type === 'importCSV') {
        if (typeof payload.data !== 'string' || Buffer.byteLength(payload.data, 'utf8') > 3 * 1024 * 1024) throw new Error('Ugyldig eller for stor CSV-fil.');
        const prepared = model.newPlayersCsv(payload.data, current.players.map(p => p.n), payload.updateExisting === true);
        if (!prepared.added && !prepared.updated) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, count: 0, skipped: prepared.skipped })); return;
        }
        // Old backends accept semicolon CSV; preserveExisting is also enforced by the new backend.
        proxiedPayload.data = prepared.csv;
        proxiedPayload.preserveExisting = payload.updateExisting !== true;
      }
      if (type === 'addPlayer') {
        const p = payload.player || {};
        if (!String(p.n || '').trim() || current.players.some(x => model.nameKey(x.n) === model.nameKey(p.n))) throw new Error('Spilleren mangler navn eller findes allerede.');
        if (!Number.isInteger(p.t) || p.t < 1 || p.t > 7) throw new Error('Timer skal være et helt tal mellem 1 og 7.');
      }
      if (type === 'save') {
        const player = current.players.find(p => p.n === (payload.playerName || payload.name));
        if (!player) throw new Error('Spilleren findes ikke i den valgte sæson.');
        const before = model.assignmentFor(player.n, current.assignments);
        if (payload.name !== before.key) throw new Error('Spillernavnet matcher ikke tildelingen. Genindlæs.');
        const next = model.holds(payload.holds);
        const equal = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');
        if (typeof payload.expectedHolds !== 'string' || !equal(before.holds, model.holds(payload.expectedHolds))) throw new Error('Tildelingen er ændret af en anden. Genindlæs før du fortsætter.');
        const added = next.filter(h => !before.holds.includes(h));
        if (added.length && next.length > model.hours(player)) throw new Error('Spilleren har allerede det ønskede antal hold.');
        for (const id of added) {
          const h = schedules[payload.season].find(h => h.id === model.base(id));
          if (!h || (id !== h.id && !(current.extraHolds || []).map(String).includes(id))) throw new Error('Holdet findes ikke i sæsonen.');
          const capacity = groupCapacity(id);
          const occupied = Object.entries(current.assignments).filter(([name, v]) => name !== before.key && model.holds(v).some(other => model.base(other) === model.base(id))).length;
          if (occupied >= capacity) throw new Error('Holdet er fyldt. Genindlæs for ny belægning.');
          if (before.holds.some(x => x !== id && model.base(x) === model.base(id))) throw new Error('Spilleren er allerede tildelt samme grundhold.');
        }
      }
    }

    const backendResponse = await fetch(requiredEnv('TTK_APPS_SCRIPT_URL'), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(proxiedPayload)
    });

    const text = await backendResponse.text();
    res.statusCode = backendResponse.ok ? 200 : backendResponse.status;
    res.setHeader('Content-Type', backendResponse.headers.get('content-type') || 'application/json; charset=utf-8');
    res.end(text);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: err.message || 'Backend proxy failed' }));
  }
};
