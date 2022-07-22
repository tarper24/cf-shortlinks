/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npx wrangler dev src/index.js` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npx wrangler publish src/index.js --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env) {
		const connectingIP = request.headers.get('CF-Connecting-IP');
		const referer = request.headers.get('referer');
		const userAgent = request.headers.get('User-Agent');

		const requestURL = new URL(request.url);
		const subdomain = requestURL.hostname.replace(RegExp(`\.?${env.BASE_HOSTNAME}$`), "");
		const pathname = requestURL.pathname.replace(/^\//, "");

		let redirectURL = await env.SHORTLINKS.get("default");
		const uuid = crypto.randomUUID();

		if (["go", "cf-shortlinks"].includes(subdomain)) {
			if (pathname !== "") {
				redirectURL = await env.SHORTLINKS.get(pathname) || redirectURL;
			}
		}
		else if (subdomain !== "") {
			redirectURL = await env.SHORTDOMAINS.get(subdomain) || redirectURL;
		}

		console.log(`${uuid} | ${connectingIP} - [${new Date().toISOString()}] "${request.method} ${request.url} ${request.cf.httpProtocol}" ${env.REDIRECT_CODE} "${referer || "-"}" "${userAgent || "-"}" `);
		console.log(`${uuid} | ${request.cf.city}, ${request.cf.regionCode || request.cf.region}, ${request.cf.country} - ${redirectURL}`);

		return Response.redirect(redirectURL, env.REDIRECT_CODE);
	},
};
