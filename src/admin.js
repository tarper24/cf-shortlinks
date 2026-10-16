// Admin UI + JSON API, served only on admin.<BASE_HOSTNAME>.

import { authenticate } from "./access.js";
import { SLUG_PATTERN, SUBDOMAIN_PATTERN, statsConfigured, queryTotals, queryDetail } from "./stats.js";
import { renderUi } from "./ui.js";

const MAX_URL_LENGTH = 2048;
const LEGACY_VALUE_LOOKUPS = 40; // stay well under the 50-subrequest limit on the free plan

// Subdomains that already have a meaning in the Worker and must not be used as redirect names.
const RESERVED_SUBDOMAINS = new Set(["admin", "go", "cf-shortlinks"]);

// The two KV-backed collections the admin manages.
const COLLECTIONS = {
	links: {
		kind: "link",
		namespace: (env) => env.SHORTLINKS,
		validate: (name) =>
			SLUG_PATTERN.test(name) ? null : "Slug must be 1-96 characters: letters, numbers, and . _ ~ / - (starting with a letter or number)",
	},
	domains: {
		kind: "domain",
		namespace: (env) => env.SHORTDOMAINS,
		validate: (name) => {
			if (!SUBDOMAIN_PATTERN.test(name)) return "Subdomain must be lowercase letters, numbers and hyphens (1-63 characters, no leading or trailing hyphen)";
			if (RESERVED_SUBDOMAINS.has(name)) return `"${name}" is reserved`;
			return null;
		},
	},
};

export function adminHostname(env) {
	return `admin.${env.BASE_HOSTNAME}`;
}

function shortBase(env) {
	if (env.SHORT_HOST) return `https://${env.SHORT_HOST}`;
	// On workers.dev there is no "go." host, links are served from the Worker's own hostname.
	return env.BASE_HOSTNAME.endsWith("workers.dev") ? `https://cf-shortlinks.${env.BASE_HOSTNAME}` : `https://go.${env.BASE_HOSTNAME}`;
}

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
	});
}

function problem(message, status = 400) {
	return json({ error: message }, status);
}

function parseDestination(raw) {
	if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return null;
	try {
		const url = new URL(raw.trim());
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
	} catch {
		return null;
	}
}

async function readJson(request) {
	try {
		return await request.json();
	} catch {
		return null;
	}
}

async function listEntries(kv) {
	const links = [];
	let cursor;
	do {
		const page = await kv.list({ cursor, limit: 1000 });
		for (const key of page.keys) {
			links.push({
				slug: key.name,
				url: key.metadata?.url ?? null,
				createdAt: key.metadata?.createdAt ?? null,
				updatedAt: key.metadata?.updatedAt ?? null,
				createdBy: key.metadata?.createdBy ?? null,
			});
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);

	// Links added by hand (dashboard / wrangler) have no metadata, so read their values instead.
	const legacy = links.filter((l) => l.url === null);
	const lookups = legacy.slice(0, LEGACY_VALUE_LOOKUPS);
	await Promise.all(
		lookups.map(async (link) => {
			link.url = await kv.get(link.slug);
		}),
	);
	return { links, unresolved: legacy.length - lookups.length };
}

async function createOrUpdate(request, env, user, collection, { requireNew }) {
	const kv = collection.namespace(env);
	const body = await readJson(request);
	if (!body) return problem("Request body must be JSON");

	// Links are keyed by "slug", subdomains by "name" ("slug" is also accepted for either).
	const raw = body.name ?? body.slug;
	const slug = typeof raw === "string" ? raw.trim() : "";
	const invalid = collection.validate(slug);
	if (invalid) return problem(invalid);
	const destination = parseDestination(body.url);
	if (!destination) return problem("Destination must be a valid http(s) URL");

	const existing = await kv.getWithMetadata(slug);
	if (requireNew && existing.value !== null) return problem(`"${slug}" already exists`, 409);
	if (!requireNew && existing.value === null) return problem(`"${slug}" does not exist`, 404);

	const now = new Date().toISOString();
	const metadata = {
		url: destination,
		createdAt: existing.metadata?.createdAt ?? now,
		createdBy: existing.metadata?.createdBy ?? user,
		...(existing.value !== null ? { updatedAt: now } : {}),
	};
	await kv.put(slug, destination, { metadata });
	return json({ slug, ...metadata }, requireNew ? 201 : 200);
}

export async function handleAdmin(request, env) {
	const url = new URL(request.url);

	const auth = await authenticate(request, env);
	if (!auth.ok) {
		return new Response(auth.reason, { status: 403, headers: { "Cache-Control": "no-store" } });
	}

	if (request.method === "GET" && url.pathname === "/") {
		return new Response(renderUi(), {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
				"Content-Security-Policy":
					"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
				"X-Content-Type-Options": "nosniff",
				"Referrer-Policy": "no-referrer",
			},
		});
	}

	if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });

	// CSRF protection for the cookie-authenticated API: browsers can't send these cross-site without CORS.
	if (request.method !== "GET") {
		const origin = request.headers.get("Origin");
		if (origin && origin !== url.origin) return problem("Cross-origin request blocked", 403);
		if (request.headers.get("X-Requested-With") !== "shortlinks-admin") return problem("Missing X-Requested-With header", 403);
	}

	const days = url.searchParams.get("days");

	try {
		if (url.pathname === "/api/config" && request.method === "GET") {
			return json({ user: auth.email, shortBase: shortBase(env), baseHostname: env.BASE_HOSTNAME, statsEnabled: statsConfigured(env) });
		}

		const collection = { "/api/links": COLLECTIONS.links, "/api/domains": COLLECTIONS.domains }[url.pathname];
		if (collection) {
			if (request.method === "GET") return json(await listEntries(collection.namespace(env)));
			if (request.method === "POST") return await createOrUpdate(request, env, auth.email, collection, { requireNew: true });
			if (request.method === "PUT") return await createOrUpdate(request, env, auth.email, collection, { requireNew: false });
			if (request.method === "DELETE") {
				const name = url.searchParams.get("slug") || url.searchParams.get("name") || "";
				const invalid = collection.validate(name);
				if (invalid) return problem("Invalid name");
				await collection.namespace(env).delete(name);
				return json({ deleted: name });
			}
		}

		if (url.pathname === "/api/stats" && request.method === "GET") {
			if (!statsConfigured(env)) return problem("Stats are not configured (CF_ACCOUNT_ID, CF_API_TOKEN, ANALYTICS_DATASET)", 501);
			return json(await queryTotals(env, days));
		}

		if (url.pathname === "/api/stats/detail" && request.method === "GET") {
			if (!statsConfigured(env)) return problem("Stats are not configured (CF_ACCOUNT_ID, CF_API_TOKEN, ANALYTICS_DATASET)", 501);
			const slug = url.searchParams.get("slug") || "";
			const kind = url.searchParams.get("kind") === "domain" ? "domain" : "link";
			const validName = kind === "domain" ? SUBDOMAIN_PATTERN.test(slug) : SLUG_PATTERN.test(slug) || slug === "(default)";
			if (!validName) return problem("Invalid slug");
			return json(await queryDetail(env, slug, days, kind));
		}
	} catch (err) {
		console.error("admin error", err);
		return problem("Internal error: " + err.message, 500);
	}

	return problem("Not found", 404);
}
