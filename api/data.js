const { requiredEnv } = require('./_lib/auth');

function parseHolds(value) {
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
  return String(value || '')
    .replace(/\s/g, '')
    .split(/[;,]/)
    .map(v => v.trim())
    .filter(Boolean);
}

function publicPayload(raw, season) {
  const players = Array.isArray(raw.players)
    ? raw.players
        .map(player => ({ n: String(player.n || player.name || '').trim() }))
        .filter(player => player.n)
    : [];

  const knownNames = new Set(players.map(player => player.n));
  const assignments = {};
  Object.entries(raw.assignments || {}).forEach(([name, holds]) => {
    const cleanName = String(name || '').trim();
    if (!cleanName || !knownNames.has(cleanName)) return;
    assignments[cleanName] = parseHolds(holds).filter(hold => /^\d+(\.\d+)?$/.test(hold));
  });

  return {
    ok: true,
    season,
    players,
    assignments,
    extraHolds: Array.isArray(raw.extraHolds) ? raw.extraHolds.map(String).filter(Boolean) : []
  };
}

module.exports = async function data(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'Use GET' }));
    return;
  }

  const season = String((req.query && req.query.season) || 'summer').toLowerCase() === 'winter' ? 'winter' : 'summer';

  try {
    const backendResponse = await fetch(requiredEnv('TTK_APPS_SCRIPT_URL'), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ type: 'load', season })
    });

    const raw = await backendResponse.json();
    if (!backendResponse.ok || !raw.ok) {
      throw new Error(raw.error || 'Could not load public data');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(publicPayload(raw, season)));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: err.message || 'Data proxy failed' }));
  }
};
