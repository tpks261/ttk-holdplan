const { SESSION_COOKIE, clearCookie } = require('../_lib/auth');

module.exports = async function logout(req, res) {
  res.statusCode = 302;
  res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE));
  res.setHeader('Location', '/');
  res.end();
};
