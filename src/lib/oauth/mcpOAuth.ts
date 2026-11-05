import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getSetting, setSetting } from "../repo";

/**
 * Browser sign-in for remote MCP servers (Figma, Canva, Notion, Linear,
 * Stripe, Sentry, Vercel, Supabase, …), per the MCP authorization spec:
 * protected-resource metadata → authorization-server metadata → dynamic
 * client registration → authorization code + PKCE in the user's browser →
 * redirect back to REX → tokens stored locally and refreshed automatically.
 * Agents then get the server with an `Authorization: Bearer` header.
 */

interface AsMeta {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

interface Stored {
  serverUrl: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
  connectedAt: number;
}

interface Pending {
  connectionId: string;
  serverUrl: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  at: number;
}

const g = globalThis as unknown as { __rexOAuthPending?: Map<string, Pending> };
const pending: Map<string, Pending> = (g.__rexOAuthPending ??= new Map());

const KEY = (id: string) => `oauth:${id}`;
const CLIENT_KEY = (issuer: string, redirect: string) => `oauth-client:${issuer}|${redirect}`;
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json", "MCP-Protocol-Version": "2025-06-18" }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** RFC 9728 + RFC 8414 discovery, with the path-insertion variants servers use in practice. */
async function discover(serverUrl: string): Promise<{ as: AsMeta; scopes?: string[] }> {
  const u = new URL(serverUrl);
  const path = u.pathname.replace(/\/$/, "");
  let prm = await getJson<{ authorization_servers?: string[]; scopes_supported?: string[] }>(`${u.origin}/.well-known/oauth-protected-resource${path}`);
  if (!prm?.authorization_servers?.length) prm = await getJson(`${u.origin}/.well-known/oauth-protected-resource`);
  const issuer = prm?.authorization_servers?.[0] ?? u.origin;
  const iu = new URL(issuer);
  const ipath = iu.pathname.replace(/\/$/, "");
  const candidates = ipath
    ? [`${iu.origin}/.well-known/oauth-authorization-server${ipath}`, `${iu.origin}/.well-known/openid-configuration${ipath}`, `${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`, `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`]
    : [`${iu.origin}/.well-known/oauth-authorization-server`, `${iu.origin}/.well-known/openid-configuration`];
  for (const c of candidates) {
    const meta = await getJson<AsMeta>(c);
    if (meta?.authorization_endpoint && meta.token_endpoint) return { as: { ...meta, issuer: meta.issuer ?? issuer }, scopes: prm?.scopes_supported };
  }
  throw new Error("This service doesn't publish OAuth sign-in metadata");
}

async function registerClient(as: AsMeta, redirectUri: string): Promise<{ clientId: string; clientSecret?: string }> {
  const cacheKey = CLIENT_KEY(as.issuer ?? as.authorization_endpoint, redirectUri);
  const cached = getSetting(cacheKey);
  if (cached) return JSON.parse(cached);
  if (!as.registration_endpoint) throw new Error("This service doesn't allow apps to register automatically");
  const r = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "REX",
      client_uri: "https://github.com/",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`App registration failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { client_id: string; client_secret?: string };
  const out = { clientId: j.client_id, clientSecret: j.client_secret };
  setSetting(cacheKey, JSON.stringify(out));
  return out;
}

/** Starts sign-in: returns the provider URL to open in the browser. */
export async function startOAuth(connectionId: string, serverUrl: string, origin: string): Promise<string> {
  const redirectUri = `${origin.replace(/\/$/, "")}/api/oauth/callback`;
  const { as, scopes } = await discover(serverUrl);
  const client = await registerClient(as, redirectUri);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  for (const [k, p] of pending) if (Date.now() - p.at > 15 * 60_000) pending.delete(k);
  pending.set(state, { connectionId, serverUrl, verifier, redirectUri, clientId: client.clientId, clientSecret: client.clientSecret, tokenEndpoint: as.token_endpoint, at: Date.now() });
  const url = new URL(as.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("resource", serverUrl);
  const scope = scopes?.length ? scopes.join(" ") : as.scopes_supported?.filter((s) => !/^(openid|profile|email)$/.test(s)).join(" ");
  if (scope) url.searchParams.set("scope", scope);
  return url.toString();
}

async function tokenRequest(endpoint: string, params: Record<string, string>, clientSecret?: string) {
  const body = new URLSearchParams(params);
  if (clientSecret) body.set("client_secret", clientSecret);
  const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Token exchange failed (${r.status}): ${text.slice(0, 200)}`);
  return JSON.parse(text) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
}

/** Redirect target: exchanges the code and stores the tokens. Returns the connection id. */
export async function finishOAuth(state: string, code: string): Promise<string> {
  const p = pending.get(state);
  if (!p) throw new Error("This sign-in link expired. Start Connect again from REX.");
  pending.delete(state);
  const t = await tokenRequest(p.tokenEndpoint, { grant_type: "authorization_code", code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: p.verifier, resource: p.serverUrl }, p.clientSecret);
  const stored: Stored = {
    serverUrl: p.serverUrl,
    tokenEndpoint: p.tokenEndpoint,
    clientId: p.clientId,
    clientSecret: p.clientSecret,
    redirectUri: p.redirectUri,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
    scope: t.scope,
    connectedAt: Date.now(),
  };
  setSetting(KEY(p.connectionId), JSON.stringify(stored));
  return p.connectionId;
}

function read(id: string): Stored | null {
  try {
    const raw = getSetting(KEY(id));
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

export function oauthStatus(id: string): { connected: boolean; connectedAt: number | null; expiresAt: number | null } {
  const s = read(id);
  return { connected: !!s, connectedAt: s?.connectedAt ?? null, expiresAt: s?.expiresAt ?? null };
}

export function disconnectOAuth(id: string) {
  setSetting(KEY(id), "");
}

/** A valid access token (refreshed when within 2 minutes of expiry), or null when not connected / refresh failed. */
export async function accessToken(id: string): Promise<string | null> {
  const s = read(id);
  if (!s) return null;
  if (!s.expiresAt || s.expiresAt - Date.now() > 120_000) return s.accessToken;
  if (!s.refreshToken) return s.accessToken;
  try {
    const t = await tokenRequest(s.tokenEndpoint, { grant_type: "refresh_token", refresh_token: s.refreshToken, client_id: s.clientId, resource: s.serverUrl }, s.clientSecret);
    const next: Stored = { ...s, accessToken: t.access_token, refreshToken: t.refresh_token ?? s.refreshToken, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined };
    setSetting(KEY(id), JSON.stringify(next));
    return next.accessToken;
  } catch {
    return null;
  }
}
