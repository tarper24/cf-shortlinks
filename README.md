# CF Shortlinks

URL shortener built on Cloudflare Workers

## Cloudflare Workers

Read the [docs](https://developers.cloudflare.com/workers/) for documentation about Cloudflare's Workers platform.

## Adding short links and subdomains

Short links (`SHORTLINKS`) and subdomain redirects (`SHORTDOMAINS`) can both be managed in the [admin UI](#admin-ui) (`admin.<base hostname>`), the Cloudflare dashboard, or Wrangler.

A subdomain redirect only takes effect once the subdomain is routed to the Worker. Either add a `[[env.<name>.routes]]` custom domain entry in `wrangler.toml` (or a custom domain in the dashboard), or connect Cloudflare in the admin **Setup** tab (see [Automatic subdomain routes](#automatic-subdomain-routes)) so adding a subdomain attaches the route for you. The names `admin`, `go` and `cf-shortlinks` are reserved.

## Admin UI

The Worker serves an admin page and JSON API on `admin.<BASE_HOSTNAME>` (`admin.t24.co` in prod, `admin.dev.tarper24.net` in dev). It has a **Links** tab and a **Subdomains** tab; each lets you add, edit, delete and search entries, and shows click statistics per entry (totals, daily chart, top referrers, countries and devices).

The admin hostname is protected by **Cloudflare Access**. The Worker also verifies the Access JWT itself, so it stays locked if the Access policy is ever removed. With no Access settings configured, the admin returns 403.

### One-time setup (per environment)

1. **Access application**: in Zero Trust, add a self-hosted application for `admin.t24.co` (and `admin.dev.tarper24.net` for dev) with a policy that allows only you. Note the **Application Audience (AUD) tag** and your team domain (`<team>.cloudflareaccess.com`).
2. **Worker variables**: add `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` under `[env.<name>.vars]` in `wrangler.toml` (they are not secret).
3. **Stats credentials**: create an API token with the `Account Analytics: Read` permission, then store it as secrets, since the Worker queries the Analytics Engine SQL API:

   ```sh
   npx wrangler secret put CF_ACCOUNT_ID --env prod
   npx wrangler secret put CF_API_TOKEN --env prod
   ```

4. Deploy. The `admin.*` custom domain routes and the Analytics Engine datasets are already declared in `wrangler.toml`.

Without step 3 the link manager still works, the stats columns just show a notice.

### Automatic subdomain routes

The **Setup** tab lets the admin attach and detach each subdomain's custom domain route on the Worker through the Cloudflare API ([attach](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/index.md) / [delete](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/delete/index.md)). It is optional. If the Cloudflare call fails, the redirect is still saved and the UI shows the error.

**One-time prerequisites** (the Setup tab tells you which are missing):

1. Create a KV namespace for the saved settings and bind it as `ADMIN_CONFIG` (commented example in `wrangler.toml`):

   ```sh
   npx wrangler kv namespace create ADMIN_CONFIG
   ```

2. Set an encryption secret of 32+ random characters. Credentials are stored in `ADMIN_CONFIG` encrypted with AES-GCM using this key, and the UI refuses to save credentials without it. If you change the key, saved credentials become unreadable and must be re-entered.

   ```sh
   npx wrangler secret put CONFIG_ENCRYPTION_KEY --env prod
   ```

Then choose how to connect in Setup. In both modes enter your account ID, the zone (e.g. `t24.co`) and the Worker name (with Wrangler environments this is `cf-shortlinks-prod` / `cf-shortlinks-dev`, preset from the `WORKER_NAME` var).

- **API token**: paste a token with the **Workers Scripts Write** permission.
- **OAuth**: create a client under *Manage Account > OAuth clients*, using the redirect URI shown in Setup (`https://admin.<base hostname>/oauth/callback`), then enter its client ID and secret and click **Connect Cloudflare**. Only the authorization code flow is supported, so the client is private to your account. The scopes field defaults to `offline_access workers-platform.write`; check the names Cloudflare lists for your account (`GET /client/v4/oauth/scopes`) and adjust if needed.

Use **Test connection** to confirm the credentials, account and Worker name work. **Remove** deletes the saved credentials (and revokes the OAuth refresh token).

Things to know:
- The hostname must be in a zone on the account; Cloudflare creates the DNS record and certificate for custom domains.
- Link (path) redirects never touch the Cloudflare API, only subdomains do.
- Routes attached this way are not in `wrangler.toml`. How `wrangler deploy` treats a domain attached outside its config has not been verified here, so try it on `dev` first.
- Existing stats credentials (`CF_ACCOUNT_ID`, `CF_API_TOKEN` secrets) are separate and unchanged.

### Local development

Put this in `.dev.vars` (gitignored). Never set it in a deployed environment, it disables the Access check:

```
ALLOW_INSECURE_ADMIN=true
```

Then run `npx wrangler dev --var BASE_HOSTNAME:localhost` and open `http://admin.localhost:8787` (browsers resolve `*.localhost` to your machine). Short links are served from `http://go.localhost:8787/<name>`.

### How stats work

Every redirect writes one data point to a [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/) dataset (`shortlinks_clicks_prod`, `shortlinks_clicks_dev`). Unknown slugs are counted together as misses rather than stored individually, so bots probing random paths cannot bloat the data. Analytics Engine keeps data for 90 days.

**`REDIRECT_CODE = 301` and stats:** browsers cache 301 redirects, so a repeat visit from the same browser never reaches the Worker and is not counted. For accurate click counts, set `REDIRECT_CODE = 302`.

### Link metadata

Links created in the UI store their destination, creation time and author in KV metadata so the list loads fast. Links added by hand have no metadata; the UI reads their values directly (up to 40 per page load) and converts them when you edit them.

## Custom domains

Custom domains will need to be added to the Cloudflare Worker in the dashboard. Additional information can be found in the Cloudflare Workers [documentation](https://developers.cloudflare.com/workers/platform/routing/custom-domains/).
