import { handleAdmin, adminHostname } from "./admin.js";
import { recordClick } from "./stats.js";

const FALLBACK_URL = "https://www.github.com/tarper24/cf-shortlinks";

export default {
	async fetch(request, env) {
		const requestURL = new URL(request.url);

		// Admin UI and API live on their own hostname, behind Cloudflare Access.
		if (requestURL.hostname === adminHostname(env)) {
			return handleAdmin(request, env);
		}

		const connectingIP = request.headers.get('CF-Connecting-IP');
		const referer = request.headers.get('referer');
		const userAgent = request.headers.get('User-Agent');

		const subdomain = requestURL.hostname.replace(RegExp(`\\.?${env.BASE_HOSTNAME}$`), "");
		const pathname = requestURL.pathname.replace(/^\//, "");

		const city = request.cf?.city ? request.cf.city + ", " : "";
		const regionCode = request.cf?.regionCode ? request.cf.regionCode + ", " : "";
		const region = request.cf?.region ? request.cf.region + ", " : regionCode;
		const country = request.cf?.country ? request.cf.country + " - " : "";

		const defaultURL = await env.SHORTLINKS.get("default") || FALLBACK_URL;
		let redirectURL = defaultURL;
		let matchedSlug = null;
		let kind = "miss";
		const uuid = crypto.randomUUID();

		if (["go", "cf-shortlinks"].includes(subdomain)) {
			if (pathname !== "") {
				const found = await env.SHORTLINKS.get(pathname);
				if (found) {
					redirectURL = found;
					matchedSlug = pathname;
					kind = "link";
				}
			}
		}
		else if (subdomain !== "") {
			const found = await env.SHORTDOMAINS.get(subdomain);
			if (found) {
				redirectURL = found;
				matchedSlug = subdomain;
				kind = "domain";
			}
		}

		console.log(`${uuid} | ${connectingIP} - [${new Date().toISOString()}] "${request.method} ${request.url} ${request.cf?.httpProtocol || "-"}" ${env.REDIRECT_CODE || "-"} "${referer || "-"}" "${userAgent || "-"}" `);
		console.log(`${uuid} | ${city}${region}${country}${redirectURL}`);

		recordClick(env, request, { slug: matchedSlug, kind, destination: redirectURL });

		return Response.redirect(redirectURL, env.REDIRECT_CODE);
	},
};
