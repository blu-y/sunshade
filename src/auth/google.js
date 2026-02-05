const http = require('http');
const keytar = require('keytar');
const { OAuth2Client } = require('google-auth-library');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const LOOPBACK_PORT = 42813;
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/generative-language'
];
const SERVICE = 'sunshade-google';
const ACCOUNT = 'default';

function ensureGoogleConfig() {
  return {
    configured: Boolean(CLIENT_ID && CLIENT_SECRET),
    clientIdPresent: Boolean(CLIENT_ID),
    clientSecretPresent: Boolean(CLIENT_SECRET)
  };
}

async function saveTokens(tokens) {
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(tokens));
}

async function loadTokens() {
  const raw = await keytar.getPassword(SERVICE, ACCOUNT);
  return raw ? JSON.parse(raw) : null;
}

async function signInWithGoogle() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Google OAuth env vars are missing (GOOGLE_CLIENT_ID/SECRET)');
  }

  const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url.startsWith('/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const url = new URL(req.url, `http://127.0.0.1:${LOOPBACK_PORT}`);
      const authCode = url.searchParams.get('code');
      res.end('Google login complete. You can close this window.');
      server.close();
      authCode ? resolve(authCode) : reject(new Error('No code returned'));
    });
    server.listen(LOOPBACK_PORT);
    require('electron').shell.openExternal(authUrl);
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  await saveTokens(tokens);
  return { status: 'ok', hasRefresh: Boolean(tokens.refresh_token) };
}

async function getValidAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Google OAuth env vars are missing (GOOGLE_CLIENT_ID/SECRET)');
  }
  const tokens = await loadTokens();
  if (!tokens) throw new Error('Not signed in');

  const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  client.setCredentials(tokens);
  const { token, res } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain access token');

  // refresh may update credentials
  if (client.credentials && JSON.stringify(client.credentials) !== JSON.stringify(tokens)) {
    await saveTokens(client.credentials);
  }
  return { token, expiry_date: client.credentials.expiry_date };
}

module.exports = {
  ensureGoogleConfig,
  signInWithGoogle,
  getValidAccessToken
};
