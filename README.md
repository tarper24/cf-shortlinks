# CF Shortlinks

URL shortener built on Cloudflare Workers

## Cloudflare Workers

Read the [docs](https://developers.cloudflare.com/workers/) for documentation about Cloudflare's Workers platform.

## Adding short links and subdomains

Short links can be managed in the [admin UI](#admin-ui) (`admin.<base hostname>`), the Cloudflare dashboard, or Wrangler. Subdomain redirects (the `SHORTDOMAINS` namespace) still need to be added manually in the dashboard or with Wrangler.

## Admin UI

The Worker serves an admin page and JSON API on `admin.<BASE_HOSTNAME>` (`admin.t24.co` in prod, `admin.dev.tarper24.net` in dev). It lets you add, edit, delete and search short links, and shows click statistics per link (totals, daily chart, top referrers, countries and devices).

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
