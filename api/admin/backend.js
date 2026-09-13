const { requireAdmin, requiredEnv } = require('../_lib/auth');

const READ_ACTIONS = new Set(['load']);
const WRITE_ACTIONS = new Set([
  'addPlayer',
  'importCSV',
  'reviewSwap',
  'save',
  'saveLevel',
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
