const https = require('https');
const {
  SESSION_COOKIE,
  STATE_COOKIE,
  clearCookie,
  cookie,
  createSession,
  getBaseUrl,
  isAllowedAdmin,
  parseCookies,
  requiredEnv,
} = require('../../_lib/auth');

function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function exchangeCodeForTokens(code, baseUrl) {
  const response = await postForm('https://oauth2.googleapis.com/token', {
    code,
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    client_secret: requiredEnv('GOOGLE_CLIENT_SECRET'),
    redirect_uri: `${baseUrl}/api/auth/callback/google`,
    grant_type: 'authorization_code'
  });

  const body = JSON.parse(response.data || '{}');
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(body.error_description || body.error || 'Google token exchange failed');
  }
  if (!body.id_token) throw new Error('Google did not return an ID token');
  return body;
}

async function verifyGoogleIdToken(idToken) {
  const response = await getJson(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  const profile = JSON.parse(response.data || '{}');
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(profile.error_description || profile.error || 'Google token verification failed');
  }
  if (profile.aud !== requiredEnv('GOOGLE_CLIENT_ID')) throw new Error('Google token audience mismatch');
  if (profile.email_verified !== 'true' && profile.email_verified !== true) throw new Error('Google email is not verified');
  return profile;
}

module.exports = async function callback(req, res) {
  try {
    const baseUrl = getBaseUrl(req);
    const url = new URL(req.url, baseUrl);
    const error = url.searchParams.get('error');
    if (error) throw new Error(error);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state || parseCookies(req)[STATE_COOKIE] !== state) throw new Error('OAuth state check failed');

    const tokens = await exchangeCodeForTokens(code, baseUrl);
    const profile = await verifyGoogleIdToken(tokens.id_token);
    const email = String(profile.email || '').toLowerCase();
    if (!isAllowedAdmin(email)) throw new Error('This Google account is not an admin');

    res.writeHead(302, {
      location: '/admin',
      'Set-Cookie': [
        cookie(SESSION_COOKIE, createSession(email), 60 * 60 * 10),
        clearCookie(STATE_COOKIE)
      ]
    });
    res.end();
  } catch (error) {
    res.statusCode = 401;
    res.setHeader('Set-Cookie', [
      clearCookie(SESSION_COOKIE),
      clearCookie(STATE_COOKIE)
    ]);
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<h1>Login fejlede</h1><p>${String(error.message || error)}</p><p><a href="/api/auth/login">Prøv igen</a></p>`);
  }
};
