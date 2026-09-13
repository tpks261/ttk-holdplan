const { ONE_HOUR_SECONDS, STATE_COOKIE, cookie, createState, getBaseUrl, requiredEnv } = require('../_lib/auth');

module.exports = async function login(req, res) {
  const baseUrl = getBaseUrl(req);
  const state = createState();
  const params = new URLSearchParams({
    client_id: requiredEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: `${baseUrl}/api/auth/callback/google`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  });

  res.setHeader('Set-Cookie', cookie(STATE_COOKIE, state, ONE_HOUR_SECONDS));
  res.statusCode = 302;
  res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.end();
};
