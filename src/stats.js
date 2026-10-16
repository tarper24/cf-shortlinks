// Click recording (Workers Analytics Engine) and stats queries (Analytics Engine SQL API).
//
// Data point layout (keep in sync with the queries below):
//   index1 = slug (max 96 bytes, the sampling key)
//   blob1  = slug
//   blob2  = kind: "link" | "domain" | "miss"
//   blob3  = country code
//   blob4  = referrer host
//   blob5  = device class
//   blob6  = destination host
//   blob7  = city
//   double1 = 1

export const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~/-]{0,95}$/;

function referrerHost(referer) {
	if (!referer) return "(direct)";
	try {
		return new URL(referer).hostname || "(direct)";
	} catch {
		return "(direct)";
	}
}

function deviceClass(userAgent) {
	if (!userAgent) return "unknown";
	if (/bot|crawler|spider|slurp|preview|facebookexternalhit|discord|telegram|slack|whatsapp|curl|wget|python|go-http/i.test(userAgent)) return "bot";
	if (/ipad|tablet/i.test(userAgent)) return "tablet";
	if (/mobi|iphone|android/i.test(userAgent)) return "mobile";
	return "desktop";
}

function hostOf(url) {
	try {
		return new URL(url).hostname;
	} catch {
		return "";
	}
}

/**
 * Record one redirect. Never throws and never blocks the redirect.
 * kind: "link" (found in SHORTLINKS), "domain" (found in SHORTDOMAINS), "miss" (fell back to default)
 */
export function recordClick(env, request, { slug, kind, destination }) {
	if (!env.CLICKS) return;
	try {
		const safeSlug = (slug || "(default)").slice(0, 96);
		env.CLICKS.writeDataPoint({
			indexes: [safeSlug],
			blobs: [
				safeSlug,
				kind,
				request.cf?.country || "??",
				referrerHost(request.headers.get("referer")),
				deviceClass(request.headers.get("user-agent")),
				hostOf(destination),
				request.cf?.city || "",
			],
			doubles: [1],
		});
	} catch (err) {
		console.error("recordClick failed", err);
	}
}

export function statsConfigured(env) {
	return Boolean(env.CF_ACCOUNT_ID && env.CF_API_TOKEN && env.ANALYTICS_DATASET);
}

function sqlString(value) {
	return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function runSql(env, sql) {
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`, {
		method: "POST",
		headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
		body: sql,
	});
	if (!res.ok) {
		throw new Error(`Analytics SQL API returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
	}
	const json = await res.json();
	return json.data || [];
}

function clampDays(days) {
	const n = Number.parseInt(days, 10);
	if (!Number.isFinite(n)) return 30;
	return Math.min(Math.max(n, 1), 90);
}

function dataset(env) {
	// The dataset name is interpolated into SQL, so it must be a plain identifier.
	if (!/^[A-Za-z0-9_]+$/.test(env.ANALYTICS_DATASET)) throw new Error("Invalid ANALYTICS_DATASET");
	return env.ANALYTICS_DATASET;
}

/** Click totals for every slug over the window. */
export async function queryTotals(env, days) {
	const d = clampDays(days);
	const rows = await runSql(
		env,
		`SELECT blob1 AS slug, blob2 AS kind, SUM(_sample_interval) AS clicks, MAX(timestamp) AS last_click
		 FROM ${dataset(env)}
		 WHERE timestamp > NOW() - INTERVAL '${d}' DAY
		 GROUP BY slug, kind
		 ORDER BY clicks DESC
		 LIMIT 1000
		 FORMAT JSON`,
	);
	return { days: d, rows: rows.map((r) => ({ slug: r.slug, kind: r.kind, clicks: Number(r.clicks), lastClick: r.last_click })) };
}

/** Time series and breakdowns for a single slug. */
export async function queryDetail(env, slug, days) {
	if (!SLUG_PATTERN.test(slug) && slug !== "(default)") throw new Error("Invalid slug");
	const d = clampDays(days);
	const table = dataset(env);
	const where = `blob1 = ${sqlString(slug)} AND timestamp > NOW() - INTERVAL '${d}' DAY`;

	const breakdown = (column) =>
		runSql(
			env,
			`SELECT ${column} AS label, SUM(_sample_interval) AS clicks
			 FROM ${table} WHERE ${where}
			 GROUP BY label ORDER BY clicks DESC LIMIT 10 FORMAT JSON`,
		);

	const [daily, referrers, countries, devices] = await Promise.all([
		runSql(
			env,
			`SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, SUM(_sample_interval) AS clicks
			 FROM ${table} WHERE ${where}
			 GROUP BY day ORDER BY day ASC FORMAT JSON`,
		),
		breakdown("blob4"),
		breakdown("blob3"),
		breakdown("blob5"),
	]);

	const shape = (rows) => rows.map((r) => ({ label: r.label, clicks: Number(r.clicks) }));
	return {
		slug,
		days: d,
		daily: daily.map((r) => ({ day: r.day, clicks: Number(r.clicks) })),
		referrers: shape(referrers),
		countries: shape(countries),
		devices: shape(devices),
	};
}
