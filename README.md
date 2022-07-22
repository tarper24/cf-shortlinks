# CF Shortlinks

URL shortener built on Cloudflare Workers

## Cloudflare Workers

Read the [docs](https://developers.cloudflare.com/workers/) for documentation about Cloudflare's Workers platform.

## Adding short links and subdomains

Shortlinks and subdomain redirects will need to be manually added to the respective Cloudflare Workers KV namespace for now. This can either be done in the dashboard or with Wrangler. Eventually, I may create a UI with authentication to help facilitate this.

## Custom domains

Custom domains will need to be added to the Cloudflare Worker in the dashboard. Additional information can be found in the Cloudflare Workers [documentation](https://developers.cloudflare.com/workers/platform/routing/custom-domains/).
