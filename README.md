# CF Shortlinks

A URL shortener that runs entirely on Cloudflare Workers. No servers, no database to host.

- **Short links**: `go.example.com/docs` redirects to any URL you choose.
- **Subdomain redirects**: `blog.example.com` redirects to any URL you choose.
- **Admin UI** at `admin.example.com`: add, edit, delete and search links and subdomains, and see click statistics (totals, daily chart, referrers, countries, devices). Protected by Cloudflare Access.
- **Optional automatic routes**: connect Cloudflare (API token or OAuth) and adding a subdomain in the UI also attaches its custom domain to the Worker.

Everything runs on Cloudflare's Workers, KV and Analytics Engine. Check Cloudflare's current pricing and free-tier limits for your expected traffic.

## How it works

One Worker answers on several hostnames under your domain:

| Hostname | What it does |
| --- | --- |
| `go.example.com/<slug>` | Looks `<slug>` up in the `SHORTLINKS` KV namespace and redirects. Unknown slugs go to the `default` key's URL. |
| `<name>.example.com` | Looks `<name>` up in the `SHORTDOMAINS` KV namespace and redirects. |
| `admin.example.com` | The admin UI and JSON API, behind Cloudflare Access. |

Each redirect also writes a data point to a Workers Analytics Engine dataset, which powers the stats in the admin UI.

The names `admin`, `go` and `cf-shortlinks` cannot be used as subdomain redirects because the Worker uses them itself.

## What you need

- A Cloudflare account (the free plan is enough to start).
- A domain whose DNS is managed by Cloudflare (an active zone). Custom domains cannot be created for a hostname that already has a CNAME record.
- [Node.js](https://nodejs.org/) (a current LTS release) and `npm`.
- Optional, for automatic deploys: a GitHub account.

## Set up from scratch

The steps below use `example.com` as your domain. Replace it with yours everywhere.

### 1. Get the code

Fork this repository (or clone it), then install dependencies:

```sh
git clone https://github.com/<you>/cf-shortlinks.git
cd cf-shortlinks
npm install
```

### 2. Log in to Cloudflare

```sh
npx wrangler login
npx wrangler whoami   # shows your account ID, you will need it later
```

### 3. Create the KV namespaces

```sh
npx wrangler kv namespace create SHORTLINKS
npx wrangler kv namespace create SHORTDOMAINS
npx wrangler kv namespace create ADMIN_CONFIG    # only needed for the Setup tab (step 9)
```

Each command prints an `id`. Keep them for the next step. (You can also create namespaces in the dashboard under *Storage & Databases > KV*.)

If you want separate dev and production deployments, create a second set and pass `--env dev` or `--env prod` (see the multi-environment note below).

### 4. Edit `wrangler.toml`

The `wrangler.toml` in this repository belongs to the original author: it contains their namespace IDs, domains and routes, so **you must replace them**. For a simple single-environment setup, replace the whole file with this:

```toml
name = "cf-shortlinks"
main = "src/index.js"
compatibility_date = "2022-07-20"
minify = true
workers_dev = false

# Routes: one custom domain per hostname the Worker answers on.
# Custom domains do not support wildcards, so every subdomain redirect needs its own entry
# (or let the admin Setup tab attach them for you, step 9).
routes = [
  { pattern = "go.example.com", custom_domain = true },
  { pattern = "admin.example.com", custom_domain = true },
]

[[kv_namespaces]]
binding = "SHORTLINKS"
id = "<SHORTLINKS id from step 3>"

[[kv_namespaces]]
binding = "SHORTDOMAINS"
id = "<SHORTDOMAINS id from step 3>"

# Optional until you use the Setup tab (step 9):
# [[kv_namespaces]]
# binding = "ADMIN_CONFIG"
# id = "<ADMIN_CONFIG id from step 3>"

[[analytics_engine_datasets]]
binding = "CLICKS"
dataset = "shortlinks_clicks"

[vars]
BASE_HOSTNAME = "example.com"        # your domain
REDIRECT_CODE = 302                  # see "Redirect code and stats" below
ANALYTICS_DATASET = "shortlinks_clicks"
WORKER_NAME = "cf-shortlinks"        # must match `name` above
# Added in step 7:
# ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"
# ACCESS_AUD = "<application AUD tag>"
```

The Analytics Engine dataset is created automatically the first time the Worker writes to it, there is nothing to set up in the dashboard.

> **Multiple environments (optional):** the original file defines `dev` and `prod` environments under `[env.dev]` and `[env.prod]`, each with its own `[[env.<name>.kv_namespaces]]`, `[[env.<name>.analytics_engine_datasets]]`, `[env.<name>.vars]` and `[[env.<name>.routes]]`. Wrangler does not inherit bindings, vars or routes into environments, so each one needs its own full set. With environments, the deployed Workers are named `cf-shortlinks-dev` and `cf-shortlinks-prod`, so set `WORKER_NAME` to match, and add `--env prod` to every `wrangler` command below.

### 5. Deploy

```sh
npx wrangler deploy
```

Cloudflare creates the DNS records and certificates for the custom domains automatically. If the deploy fails on a domain, check that the zone is active on your account and that no existing DNS record (such as a CNAME) is using that hostname.

### 6. Add a default destination and a first link

The `default` key is where unknown slugs (and the bare `go.example.com`) redirect to:

```sh
npx wrangler kv key put default "https://example.com" --binding SHORTLINKS --remote
npx wrangler kv key put hello "https://example.com/hello" --binding SHORTLINKS --remote
```

Visit `https://go.example.com/hello` to test. (`--remote` writes to the real namespace; without it newer Wrangler versions write to a local copy.)

Links created this way are fully supported. The admin UI reads them and converts them to its own format when you edit them.

### 7. Protect the admin UI with Cloudflare Access

The admin hostname refuses all requests until Access is configured. The Worker verifies the Access token itself, so a misconfigured Access policy cannot expose it.

1. In the Cloudflare dashboard open **Zero Trust**. If this is your first time, choose a team name and a plan (the Free plan covers small teams, check the current limits). Your team domain is `<team>.cloudflareaccess.com`, shown under Zero Trust settings.
2. Go to *Access controls > Applications* and add a **self-hosted** application with the public hostname `admin.example.com`.
3. Add a policy that **allows only you** (for example, an *Allow* policy for your email address). Applications are deny-by-default.
4. After saving, open the application and copy its **Application Audience (AUD) tag**.
5. Put both values in `wrangler.toml` under `[vars]`:

   ```toml
   ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"
   ACCESS_AUD = "<AUD tag>"
   ```

6. Deploy again with `npx wrangler deploy`, then open `https://admin.example.com` and sign in.

You can now add and edit links and subdomains in the browser. The stats columns will show a notice until you finish step 8.

### 8. Turn on click statistics

Stats are queried through Cloudflare's Analytics Engine SQL API, which needs an API token.

1. Create an API token (*My Profile > API Tokens > Create Token > Create Custom Token*) with the permission **Account > Account Analytics > Read**.
2. Store the token and your account ID as Worker secrets:

   ```sh
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put CF_API_TOKEN
   ```

Reload the admin page. Clicks are counted from the moment the Worker was deployed with the analytics binding.

> This `CF_API_TOKEN` is a *Worker secret* with read-only analytics access. It is **not** the same as the GitHub Actions deploy token in step 10, even though both use the same name.

### 9. (Optional) Automatic subdomain routes from the admin UI

A subdomain redirect only takes effect once the subdomain is attached to the Worker as a custom domain. You can do that by hand (add a `routes` entry in `wrangler.toml` and redeploy, or add a custom domain in the dashboard), or connect Cloudflare in the admin **Setup** tab so adding or deleting a subdomain attaches or detaches the route for you ([attach](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/index.md), [delete](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/delete/index.md)). If the Cloudflare call fails, the redirect is still saved and the UI shows the error.

**Prerequisites**

1. Uncomment the `ADMIN_CONFIG` KV binding in `wrangler.toml` (created in step 3).
2. Set an encryption secret of 32+ random characters. Saved credentials are encrypted with AES-GCM using it, and the UI refuses to save credentials without it:

   ```sh
   npx wrangler secret put CONFIG_ENCRYPTION_KEY
   ```

   If you change this key later, saved credentials become unreadable and must be entered again.
3. Redeploy: `npx wrangler deploy`.

**Connect** (open the **Setup** tab). In both modes enter your account ID, the zone (`example.com`) and the Worker name (`cf-shortlinks`, preset from `WORKER_NAME`), then pick a method:

- **API token**: create a token with the **Workers Scripts Write** permission and paste it. Simplest option.
- **OAuth**: in the dashboard go to *Manage Account > OAuth clients > Create client*, use the redirect URI shown in Setup (`https://admin.example.com/oauth/callback`), then enter the client ID and secret and click **Connect Cloudflare**. Cloudflare supports only the authorization code flow for these clients, and a new client is private to your account, which is all this needs. The scopes field defaults to `offline_access workers-platform.write`; confirm the names Cloudflare lists for your account (`GET /client/v4/oauth/scopes`) and adjust if the consent screen rejects them.

Click **Test connection** to confirm the credentials, account and Worker name work. **Remove** deletes the saved credentials and revokes the OAuth refresh token.

Notes:
- Link (path) redirects never use the Cloudflare API, only subdomains do.
- Routes attached this way are not written to `wrangler.toml`. How `wrangler deploy` treats a custom domain that was attached outside its config has not been verified, so try it on a non-production environment first.

### 10. (Optional) Deploy automatically from GitHub

`.github/workflows/deploy.yml` deploys with [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action).

1. Create a Cloudflare API token for deploying (the **Edit Cloudflare Workers** template is a good start). If a deploy fails while creating custom domains, add the zone permissions it reports (for example DNS edit on your zone).
2. In your GitHub repository go to *Settings > Secrets and variables > Actions* and add two **repository secrets**: `CF_API_TOKEN` (the deploy token) and `CF_ACCOUNT_ID`.
3. Pushing to `main` now deploys. Worker secrets and variables set with `wrangler secret put` are kept between deploys; `[vars]` come from `wrangler.toml`.

The workflow passes an `environment` input to Wrangler. A push to `main` deploys with **no** environment, which is the top-level config, exactly what the single-environment `wrangler.toml` above uses. If you use `dev` and `prod` environments, run the workflow manually (*Actions > Deploy Worker > Run workflow*) and pick the environment, or change the workflow to set `environment` yourself.

## Using the admin UI

Open `https://admin.example.com`.

- **Links tab**: add a short name and destination URL. Slugs can contain letters, numbers and `. _ ~ / -`, up to 96 characters. Edit, delete, copy the short URL, search, and open per-link stats.
- **Subdomains tab**: same for subdomain redirects. Names must be lowercase letters, numbers and hyphens.
- **Stats**: choose 7, 30 or 90 days. Each entry shows total clicks and last click, plus a detail view with a daily chart and top referrers, countries and devices. Requests that matched nothing are reported together as "did not match any link" so bots probing random paths cannot bloat your data.
- **Setup tab**: the optional Cloudflare connection from step 9.

Changes can take up to about a minute to reach every Cloudflare location (KV is eventually consistent).

## Redirect code and stats

`REDIRECT_CODE = 301` makes browsers cache the redirect, so repeat visits from the same browser never reach the Worker and are **not counted**. Use `302` (as in the example above) if accurate click counts matter more than browser caching. Analytics Engine retains data for a limited time (roughly 90 days; see Cloudflare's limits page), and the UI caps the window at 90 days.

## Configuration reference

**Bindings** (`wrangler.toml`)

| Binding | Type | Purpose |
| --- | --- | --- |
| `SHORTLINKS` | KV | slug → destination URL (`default` key = fallback) |
| `SHORTDOMAINS` | KV | subdomain → destination URL |
| `ADMIN_CONFIG` | KV | Setup tab settings and encrypted credentials (optional) |
| `CLICKS` | Analytics Engine | one data point per redirect |

**Variables** (`[vars]`, not secret)

| Name | Required | Purpose |
| --- | --- | --- |
| `BASE_HOSTNAME` | yes | your domain, e.g. `example.com` |
| `REDIRECT_CODE` | yes | `301` or `302` |
| `ANALYTICS_DATASET` | for stats | dataset name, must match the binding's `dataset` |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | for admin | Cloudflare Access verification |
| `WORKER_NAME` | for Setup | the Worker's deployed name |
| `SHORT_HOST` | no | override the host shown when copying short links (default `go.<BASE_HOSTNAME>`) |

**Secrets** (`wrangler secret put`)

| Name | Needed for | Purpose |
| --- | --- | --- |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | stats | read-only Analytics token (Account Analytics Read) |
| `CONFIG_ENCRYPTION_KEY` | Setup tab | 32+ character key used to encrypt saved credentials |

**GitHub Actions secrets** (repository settings): `CF_API_TOKEN` (deploy token) and `CF_ACCOUNT_ID`.

## Local development

Create `.dev.vars` (gitignored) with:

```
ALLOW_INSECURE_ADMIN=true
```

This disables the Access check so you can try the admin locally. **Never set it in a deployed environment.** Then run:

```sh
npx wrangler dev --var BASE_HOSTNAME:localhost
```

and open `http://admin.localhost:8787` (browsers resolve `*.localhost` to your own machine). Short links are served from `http://go.localhost:8787/<slug>`. Local runs use local KV storage, not your real namespaces.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Admin page says *Admin is disabled: ACCESS_TEAM_DOMAIN and ACCESS_AUD are not configured* | Step 7 vars missing or not deployed |
| *Missing Cloudflare Access token* | The Access application does not cover `admin.example.com`, or you are reaching the Worker another way |
| *Access token rejected: Wrong audience* / *Wrong issuer* | `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` does not match the Access application |
| Stats columns say *not configured* | Step 8 secrets missing (`CF_ACCOUNT_ID`, `CF_API_TOKEN`, and the `ANALYTICS_DATASET` var) |
| Stats show zero clicks | `REDIRECT_CODE` is `301` and browsers cached the redirect, or no clicks since the binding was deployed |
| Setup tab says `ADMIN_CONFIG` is not bound or `CONFIG_ENCRYPTION_KEY` is not set | Step 9 prerequisites |
| *Redirect saved, but attaching the route failed* | See the message: wrong account ID, Worker name or zone; token missing the Workers Scripts Write permission; or the hostname already has a DNS record |
| New subdomain redirects to the default page | The subdomain is not attached to the Worker yet (add a route, or use step 9) |
| *Could not decrypt saved credentials* | `CONFIG_ENCRYPTION_KEY` changed; enter the credentials again in Setup |

## Security notes

- The admin API only responds to requests carrying a valid Cloudflare Access token for your Access application, and rejects cross-site requests.
- Credentials saved by the Setup tab are encrypted at rest in KV and are never sent back to the browser.
- The deploy token (GitHub), the analytics token (Worker secret) and the Setup token or OAuth client are separate credentials with different permissions, so you can revoke each independently.
- Redirect destinations must be `http` or `https` URLs.

## Learn more

- [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
- [Worker Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/)
- [Cloudflare OAuth clients](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/)
