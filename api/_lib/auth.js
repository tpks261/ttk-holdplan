const crypto = require('crypto');

const SESSION_COOKIE = 'ttk_admin_session';
const STATE_COOKIE = 'ttk_oauth_state';
const ONE_HOUR_SECONDS = 60 * 60;
const ONE_WEEK_SECONDS = 7 * 24 * ONE_HOUR_SECONDS;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sign(value) {
  return base64url(crypto.createHmac('sha256', requiredEnv('AUTH_SECRET')).update(value).digest());
}

function encodeSignedJson(payload) {
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function decodeSignedJson(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature || sign(body) !== signature) return null;

  try {
    const json = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const idx = part.indexOf('=');
      if (idx > -1) cookies[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
      return cookies;
    }, {});
}

function cookie(name, value, maxAgeSeconds) {
  const pieces = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];

  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) pieces.push('Secure');
  return pieces.join('; ');
}

function clearCookie(name) {
  return cookie(name, '', 0);
}

function getBaseUrl(req) {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (configured) return configured.replace(/\/$/, '');

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedAdmin(email) {
  return getAdminEmails().includes(String(email || '').trim().toLowerCase());
}

function createState() {
  return crypto.randomBytes(24).toString('hex');
}

function createSession(email) {
  return encodeSignedJson({
    email: String(email || '').trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ONE_WEEK_SECONDS
  });
}

function readSession(req) {
  const payload = decodeSignedJson(parseCookies(req)[SESSION_COOKIE]);
  if (!payload || !isAllowedAdmin(payload.email)) return null;
  return { email: payload.email };
}

function requireAdmin(req, res) {
  const session = readSession(req);
  if (session) return session;

  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: false, error: 'Not signed in as an allowed admin' }));
  return null;
}

module.exports = {
  ONE_HOUR_SECONDS,
  SESSION_COOKIE,
  STATE_COOKIE,
  clearCookie,
  cookie,
  createSession,
  createState,
  getBaseUrl,
  isAllowedAdmin,
  parseCookies,
  readSession,
  requireAdmin,
  requiredEnv
};
