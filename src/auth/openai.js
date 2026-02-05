// Lightweight ChatGPT OAuth (Codex backend) helper for this app.
// Reuses the same public client/redirect used by the Codex CLI and
// opencode-openai-codex-auth, but without any opencode dependency.

const http = require("http");
const crypto = require("node:crypto");
const { shell } = require("electron");
const keytar = require("keytar");

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPES = "openid profile email offline_access";
const KEYTAR_SERVICE = "sunshade-openai-codex";
const KEYTAR_ACCOUNT = "default";

function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generatePkce() {
  const verifier = base64Url(crypto.randomBytes(48));
  const challenge = base64Url(
    crypto.createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

function decodeJwt(token) {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractClaims(token) {
  const decoded = decodeJwt(token);
  const authClaim = decoded?.["https://api.openai.com/auth"];
  return {
    accountId: authClaim?.chatgpt_account_id,
  };
}

async function saveTokens(tokens) {
  await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, JSON.stringify(tokens));
}

async function loadTokens() {
  const raw = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  return raw ? JSON.parse(raw) : null;
}

async function logoutTokens() {
  await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
}

function buildAuthUrl(pkce, state) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");
  return url.toString();
}

function waitForAuthCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url.startsWith("/auth/callback")) {
        res.writeHead(404);
        res.end();
        return;
      }

      const url = new URL(req.url, "http://localhost:1455");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code) {
        res.end("Missing code");
        server.close();
        return reject(new Error("No code returned"));
      }
      if (state !== expectedState) {
        res.end("State mismatch");
        server.close();
        return reject(new Error("OAuth state mismatch"));
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenAI Sign-in Complete</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Inter", system-ui, -apple-system, sans-serif;
      background: radial-gradient(circle at 20% 20%, #e0e7ff 0, transparent 35%),
                  radial-gradient(circle at 80% 30%, #cffafe 0, transparent 32%),
                  #f8fafc;
      color: #0f172a;
    }
    .card {
      background: rgba(255,255,255,0.9);
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 24px 26px;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12);
      max-width: 420px;
      text-align: center;
    }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 6px 0 0; color: #334155; line-height: 1.5; }
    .hint { margin-top: 12px; font-size: 13px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign-in Successful</h1>
    <p>You can close this tab and return to the app.</p>
    <p class="hint">If this window does not close automatically, simply close it manually.</p>
  </div>
</body>
</html>`);
      server.close();
      resolve(code);
    });

    server.listen(1455, "127.0.0.1");

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth timed out"));
    }, 180_000);

    server.on("close", () => clearTimeout(timeout));
  });
}

async function exchangeAuthorizationCode(code, verifier) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`token exchange failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  const { access_token, refresh_token, expires_in } = json;
  if (!access_token || !refresh_token || typeof expires_in !== "number") {
    throw new Error("token response missing fields");
  }

  const { accountId } = extractClaims(access_token);

  return {
    access: access_token,
    refresh: refresh_token,
    expires: Date.now() + expires_in * 1000,
    accountId,
  };
}

async function refreshTokens(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`refresh failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  const { access_token, refresh_token, expires_in } = json;
  if (!access_token || !refresh_token || typeof expires_in !== "number") {
    throw new Error("refresh response missing fields");
  }

  const { accountId } = extractClaims(access_token);

  return {
    access: access_token,
    refresh: refresh_token,
    expires: Date.now() + expires_in * 1000,
    accountId,
  };
}

function isExpired(expires) {
  return !expires || Date.now() > expires - 60_000; // refresh 1 minute early
}

async function signInWithOpenAI() {
  const pkce = generatePkce();
  const state = crypto.randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl(pkce, state);

  shell.openExternal(authUrl);
  const code = await waitForAuthCode(state);
  const tokens = await exchangeAuthorizationCode(code, pkce.verifier);
  await saveTokens(tokens);
  return {
    status: "ok",
    accountId: tokens.accountId,
    expires: tokens.expires,
  };
}

async function getValidOpenAIToken() {
  const tokens = await loadTokens();
  if (!tokens) throw new Error("OpenAI에 로그인되어 있지 않습니다.");

  if (isExpired(tokens.expires)) {
    const refreshed = await refreshTokens(tokens.refresh);
    await saveTokens(refreshed);
    return {
      token: refreshed.access,
      accountId: refreshed.accountId,
      expires: refreshed.expires,
    };
  }

  const { accountId } = extractClaims(tokens.access);

  return {
    token: tokens.access,
    accountId: tokens.accountId || accountId,
    expires: tokens.expires,
  };
}

async function ensureOpenAIConfig() {
  const tokens = await loadTokens();
  const claims = tokens?.access ? extractClaims(tokens.access) : {};
  return {
    hasTokens: Boolean(tokens?.access && tokens?.refresh),
    expires: tokens?.expires ?? null,
    accountId: tokens?.accountId || claims.accountId || null,
  };
}

async function logoutOpenAI() {
  await logoutTokens();
  return { status: "logged_out" };
}

module.exports = {
  ensureOpenAIConfig,
  signInWithOpenAI,
  getValidOpenAIToken,
  logoutOpenAI,
};
