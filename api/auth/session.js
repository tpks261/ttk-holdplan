const { readSession } = require('../_lib/auth');

module.exports = async function session(req, res) {
  const current = readSession(req);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    signedIn: Boolean(current),
    email: current ? current.email : null
  }));
};
