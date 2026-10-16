// Cloudflare API access for managing Worker custom domains (subdomain routes).
//
// Two ways to authenticate, chosen in the admin Setup tab:
//   - "api_token": an API token with the "Workers Scripts Write" permission
//   - "oauth":     a private Cloudflare OAuth client (authorization code flow with a client secret)
//
// Everything is saved in the ADMIN_CONFIG KV namespace. Credentials are encrypted with
// CONFIG_ENCRYPTION_KEY; non-secret settings are stored in the clear so the UI can show them.

import { encryptJson, decryptJson, encryptionReady } from "./crypto.js";

export { encryptionReady };

const CONFIG_KEY = "cloudflare";
const STATE_PREFIX = "oauth_state:";
const API_BASE = "https://api.cloudflare.com/client/v4";
const OAUTH_FALLBACK = {
	authorization_endpoint: "https://dash.cloudflare.com/oauth2/auth",
	token_endpoint: "https://dash.cloudflare.com/oauth2/token",
	revocation_endpoint: "https://dash.cloudflare.com/oauth2/revoke",
};
export const DEFAULT_SCOPES = "offline_access workers-platform.write";

export function storageReady(env) {
	return Boolean(env.ADMIN_CONFIG);
}

export function redirectUri(env, adminHost) {
	return `https://${adminHost}/oauth/callback`;
}

// ---------- saved configuration ----------

async function readRecord(env) {
	if (!storageReady(env)) return null;
	const raw = await env.ADMIN_CONFIG.get(CONFIG_KEY);
	return raw ? JSON.parse(raw) : null;
}

async function readSecrets(env, record) {
	if (!record?.secrets) return {};
	return decryptJson(env, record.secrets);
}

async function writeRecord(env, record, secrets) {
	record.secrets = Object.keys(secrets).length ? await encryptJson(env, secrets) : null;
	await env.ADMIN_CONFIG.put(CONFIG_KEY, JSON.stringify(record));
}

/** Settings safe to show in the UI. Never includes secret values. */
export async function publicConfig(env) {
	const record = await readRecord(env);
	if (!record) return null;
	let secrets = {};
	try {
		secrets = await readSecrets(env, record);
	} catch {
		// Key changed or data corrupt: report as having no credentials so the user can re-enter them.
	}
	return {
		mode: record.mode,
		accountId: record.accountId,
		zoneName: record.zoneName,
		workerName: record.workerName,
		clientId: record.clientId || "",
		scopes: record.scopes || DEFAULT_SCOPES,
		hasApiToken: Boolean(secrets.apiToken),
		hasClientSecret: Boolean(secrets.clientSecret),
		connected: Boolean(secrets.refreshToken || secrets.accessToken),
		connectedAt: record.connectedAt || null,
	};
}

const ACCOUNT_ID = /^[a-f0-9]{32}$/i;
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const WORKER_NAME = /^[A-Za-z0-9_-]{1,63}$/;
const SCOPES = /^[A-Za-z0-9_.: -]{1,500}$/;

/** Validate and save setup input. Blank secret fields keep the stored value. Returns an error string or null. */
export async function saveSetup(env, input) {
	if (!storageReady(env)) return "ADMIN_CONFIG KV namespace is not bound";
	if (!encryptionReady(env)) return "CONFIG_ENCRYPTION_KEY is not set (32+ characters)";

	const mode = input.mode;
	if (mode !== "api_token" && mode !== "oauth") return "Mode must be api_token or oauth";
	const accountId = String(input.accountId || "").trim();
	if (!ACCOUNT_ID.test(accountId)) return "Account ID must be 32 hexadecimal characters";
	const zoneName = String(input.zoneName || "").trim().toLowerCase();
	if (!HOSTNAME.test(zoneName)) return "Zone must be a domain name such as example.com";
	const workerName = String(input.workerName || "").trim();
	if (!WORKER_NAME.test(workerName)) return "Worker name may only contain letters, numbers, - and _";

	const existing = await readRecord(env);
	let secrets = {};
	if (existing) {
		try {
			secrets = await readSecrets(env, existing);
		} catch {
			secrets = {}; // unreadable (key changed): start over
		}
	}

	const record = { mode, accountId, zoneName, workerName, clientId: "", scopes: DEFAULT_SCOPES, connectedAt: existing?.connectedAt || null };
	const next = {};

	if (mode === "api_token") {
		const token = typeof input.apiToken === "string" ? input.apiToken.trim() : "";
		next.apiToken = token || secrets.apiToken;
		if (!next.apiToken) return "An API token is required";
		record.connectedAt = existing?.mode === "api_token" ? record.connectedAt : null;
	} else {
		const clientId = String(input.clientId || "").trim();
		if (!clientId || clientId.length > 128) return "A client ID is required";
		const scopes = String(input.scopes || DEFAULT_SCOPES).trim();
		if (!SCOPES.test(scopes)) return "Scopes may only contain letters, numbers and . _ : -";
		const clientSecret = typeof input.clientSecret === "string" ? input.clientSecret.trim() : "";
		next.clientSecret = clientSecret || (existing?.clientId === clientId ? secrets.clientSecret : undefined);
		if (!next.clientSecret) return "A client secret is required";
		record.clientId = clientId;
		record.scopes = scopes;
		// Keep tokens only while the client and scopes are unchanged, otherwise the user must reconnect.
		if (existing?.mode === "oauth" && existing.clientId === clientId && existing.scopes === scopes && !clientSecret) {
			next.accessToken = secrets.accessToken;
			next.refreshToken = secrets.refreshToken;
			next.expiresAt = secrets.expiresAt;
		} else {
			record.connectedAt = null;
		}
	}

	for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
	await writeRecord(env, record, next);
	return null;
}

export async function clearSetup(env) {
	if (!storageReady(env)) return;
	const record = await readRecord(env);
	if (record?.mode === "oauth" && encryptionReady(env)) {
		// Best effort: revoke the refresh token so it cannot be used again.
		try {
			const secrets = await readSecrets(env, record);
			if (secrets.refreshToken) {
				const endpoints = await oauthEndpoints();
				await fetch(endpoints.revocation_endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth(record.clientId, secrets.clientSecret) },
					body: new URLSearchParams({ token: secrets.refreshToken, token_type_hint: "refresh_token" }),
				});
			}
		} catch (err) {
			console.error("token revoke failed", err);
		}
	}
	await env.ADMIN_CONFIG.delete(CONFIG_KEY);
}

// ---------- OAuth ----------

let discoveryCache = null;
async function oauthEndpoints() {
	if (discoveryCache) return discoveryCache;
	try {
		const res = await fetch("https://dash.cloudflare.com/.well-known/openid-configuration");
		if (res.ok) {
			const doc = await res.json();
			discoveryCache = {
				authorization_endpoint: doc.authorization_endpoint || OAUTH_FALLBACK.authorization_endpoint,
				token_endpoint: doc.token_endpoint || OAUTH_FALLBACK.token_endpoint,
				revocation_endpoint: doc.revocation_endpoint || OAUTH_FALLBACK.revocation_endpoint,
			};
			return discoveryCache;
		}
	} catch {
		// fall through to the documented defaults
	}
	return OAUTH_FALLBACK;
}

function basicAuth(id, secret) {
	return "Basic " + btoa(`${id}:${secret}`);
}

function randomString(bytes) {
	const arr = crypto.getRandomValues(new Uint8Array(bytes));
	let bin = "";
	for (const b of arr) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256b64u(value) {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
	let bin = "";
	for (const b of digest) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Builds the Cloudflare consent URL and remembers the PKCE verifier under a one-time state value. */
export async function startOAuth(env, adminHost) {
	const record = await readRecord(env);
	if (!record || record.mode !== "oauth") throw new Error("Save OAuth settings first");
	const secrets = await readSecrets(env, record);
	if (!record.clientId || !secrets.clientSecret) throw new Error("Save the client ID and client secret first");

	const state = randomString(24);
	const verifier = randomString(48);
	await env.ADMIN_CONFIG.put(STATE_PREFIX + state, JSON.stringify({ verifier }), { expirationTtl: 600 });

	const endpoints = await oauthEndpoints();
	const url = new URL(endpoints.authorization_endpoint);
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: record.clientId,
		redirect_uri: redirectUri(env, adminHost),
		scope: record.scopes || DEFAULT_SCOPES,
		state,
		code_challenge: await sha256b64u(verifier),
		code_challenge_method: "S256",
	}).toString();
	return url.toString();
}

async function tokenRequest(record, secrets, params) {
	const endpoints = await oauthEndpoints();
	const res = await fetch(endpoints.token_endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth(record.clientId, secrets.clientSecret), Accept: "application/json" },
		body: new URLSearchParams(params),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data.access_token) {
		throw new Error(`Cloudflare token endpoint: ${data.error_description || data.error || res.status}`);
	}
	return data;
}

/** Completes the redirect from Cloudflare: validates state, exchanges the code and stores the tokens. */
export async function finishOAuth(env, adminHost, params) {
	if (params.get("error")) throw new Error(`Cloudflare declined the request: ${params.get("error_description") || params.get("error")}`);
	const code = params.get("code");
	const state = params.get("state");
	if (!code || !state) throw new Error("Missing code or state");

	const stored = await env.ADMIN_CONFIG.get(STATE_PREFIX + state);
	if (!stored) throw new Error("Unknown or expired state, start the connection again");
	await env.ADMIN_CONFIG.delete(STATE_PREFIX + state); // one use only
	const { verifier } = JSON.parse(stored);

	const record = await readRecord(env);
	if (!record || record.mode !== "oauth") throw new Error("OAuth is not configured");
	const secrets = await readSecrets(env, record);

	const data = await tokenRequest(record, secrets, {
		grant_type: "authorization_code",
		code,
		redirect_uri: redirectUri(env, adminHost),
		code_verifier: verifier,
	});
	const next = {
		clientSecret: secrets.clientSecret,
		accessToken: data.access_token,
		refreshToken: data.refresh_token || secrets.refreshToken,
		expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
	};
	if (!next.refreshToken) delete next.refreshToken;
	record.connectedAt = new Date().toISOString();
	await writeRecord(env, record, next);
}

// ---------- calling the Cloudflare API ----------

async function accessToken(env, record) {
	const secrets = await readSecrets(env, record);
	if (record.mode === "api_token") {
		if (!secrets.apiToken) throw new Error("No API token saved");
		return secrets.apiToken;
	}
	if (secrets.accessToken && secrets.expiresAt && secrets.expiresAt - Date.now() > 60_000) return secrets.accessToken;
	if (!secrets.refreshToken) {
		if (secrets.accessToken && !secrets.expiresAt) return secrets.accessToken;
		throw new Error("Cloudflare is not connected (or the connection expired). Use Connect Cloudflare in Setup.");
	}
	const data = await tokenRequest(record, secrets, { grant_type: "refresh_token", refresh_token: secrets.refreshToken });
	const next = {
		clientSecret: secrets.clientSecret,
		accessToken: data.access_token,
		refreshToken: data.refresh_token || secrets.refreshToken, // refresh tokens may rotate
		expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
	};
	await writeRecord(env, record, next);
	return next.accessToken;
}

async function cf(env, record, method, path, body) {
	const token = await accessToken(env, record);
	const res = await fetch(API_BASE + path, {
		method,
		headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || data.success === false) {
		const detail = (data.errors || []).map((e) => e.message).join("; ") || `HTTP ${res.status}`;
		throw new Error(detail);
	}
	return data.result;
}

/** True when credentials are saved and usable for route management. */
export async function routesEnabled(env) {
	try {
		const cfg = await publicConfig(env);
		if (!cfg) return false;
		return cfg.mode === "api_token" ? cfg.hasApiToken : cfg.connected;
	} catch {
		return false;
	}
}

/** Reads (without changing anything) to prove the saved credentials, account and Worker name work. */
export async function testConnection(env) {
	const record = await readRecord(env);
	if (!record) throw new Error("Nothing is saved yet");
	const domains = await cf(env, record, "GET", `/accounts/${record.accountId}/workers/domains?service=${encodeURIComponent(record.workerName)}`);
	return { domains: Array.isArray(domains) ? domains.length : 0 };
}

function fullHostname(record, name) {
	return `${name}.${record.zoneName}`;
}

/** Attach <name>.<zone> to the Worker. Never throws: returns { status, message } for the UI. */
export async function attachRoute(env, name) {
	try {
		const record = await readRecord(env);
		if (!record || !(await routesEnabled(env))) return { status: "skipped", message: "Cloudflare route management is not set up, add the route manually." };
		const hostname = fullHostname(record, name);
		await cf(env, record, "PUT", `/accounts/${record.accountId}/workers/domains`, {
			hostname,
			service: record.workerName,
			zone_name: record.zoneName,
		});
		return { status: "attached", message: `${hostname} is routed to ${record.workerName}.` };
	} catch (err) {
		return { status: "failed", message: `Redirect saved, but attaching the route failed: ${err.message}` };
	}
}

/** Detach <name>.<zone> from the Worker. Never throws. */
export async function detachRoute(env, name) {
	try {
		const record = await readRecord(env);
		if (!record || !(await routesEnabled(env))) return { status: "skipped", message: "Cloudflare route management is not set up, remove the route manually if one exists." };
		const hostname = fullHostname(record, name);
		const found = await cf(
			env,
			record,
			"GET",
			`/accounts/${record.accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}&service=${encodeURIComponent(record.workerName)}`,
		);
		const match = (Array.isArray(found) ? found : []).find((d) => d.hostname === hostname);
		if (!match) return { status: "absent", message: `${hostname} was not routed to ${record.workerName}.` };
		await cf(env, record, "DELETE", `/accounts/${record.accountId}/workers/domains/${match.id}`);
		return { status: "detached", message: `${hostname} was removed from ${record.workerName}.` };
	} catch (err) {
		return { status: "failed", message: `Redirect removed, but detaching the route failed: ${err.message}` };
	}
}
