// Verifies the Cloudflare Access JWT (Cf-Access-Jwt-Assertion header) so the admin UI
// stays protected even if the Access policy is removed or the Worker is reached some other way.
//
// Required vars: ACCESS_TEAM_DOMAIN (e.g. "myteam.cloudflareaccess.com") and ACCESS_AUD (application AUD tag).
// Local development only: set ALLOW_INSECURE_ADMIN = "true" (e.g. in .dev.vars) to skip verification.

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { teamDomain: null, fetchedAt: 0, keys: [] };

function b64urlToBytes(value) {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	const bin = atob(padded);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decodeJson(part) {
	return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function getKeys(teamDomain, forceRefresh = false) {
	const fresh = jwksCache.teamDomain === teamDomain && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
	if (fresh && !forceRefresh) return jwksCache.keys;
	const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
	if (!res.ok) throw new Error(`Could not fetch Access certs (${res.status})`);
	const { keys } = await res.json();
	jwksCache = { teamDomain, fetchedAt: Date.now(), keys };
	return keys;
}

async function verifyJwt(token, env) {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("Malformed token");
	const [headerPart, payloadPart, signaturePart] = parts;
	const header = decodeJson(headerPart);
	const payload = decodeJson(payloadPart);
	if (header.alg !== "RS256") throw new Error("Unexpected algorithm");

	let keys = await getKeys(env.ACCESS_TEAM_DOMAIN);
	let jwk = keys.find((k) => k.kid === header.kid);
	if (!jwk) {
		keys = await getKeys(env.ACCESS_TEAM_DOMAIN, true); // keys may have rotated
		jwk = keys.find((k) => k.kid === header.kid);
	}
	if (!jwk) throw new Error("Unknown signing key");

	const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
	const valid = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		key,
		b64urlToBytes(signaturePart),
		new TextEncoder().encode(`${headerPart}.${payloadPart}`),
	);
	if (!valid) throw new Error("Bad signature");

	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== "number" || payload.exp < now) throw new Error("Token expired");
	if (typeof payload.nbf === "number" && payload.nbf > now + 60) throw new Error("Token not yet valid");
	if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new Error("Wrong issuer");
	const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!aud.includes(env.ACCESS_AUD)) throw new Error("Wrong audience");
	return payload;
}

/** Returns { ok: true, email } when the request is authorised, otherwise { ok: false, reason }. */
export async function authenticate(request, env) {
	if (env.ALLOW_INSECURE_ADMIN === "true") {
		return { ok: true, email: "local-dev" };
	}
	if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
		return { ok: false, reason: "Admin is disabled: ACCESS_TEAM_DOMAIN and ACCESS_AUD are not configured" };
	}
	const token = request.headers.get("Cf-Access-Jwt-Assertion");
	if (!token) return { ok: false, reason: "Missing Cloudflare Access token" };
	try {
		const payload = await verifyJwt(token, env);
		return { ok: true, email: payload.email || payload.sub || "unknown" };
	} catch (err) {
		return { ok: false, reason: `Access token rejected: ${err.message}` };
	}
}
