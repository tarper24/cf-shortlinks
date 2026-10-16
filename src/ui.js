// Single-page admin UI. Plain HTML/CSS/JS, no build step.
// Client script avoids backticks so it can live inside this template literal; all dynamic text is set via textContent.

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Short links</title>
<style>
:root {
	color-scheme: light dark;
	--bg: #f6f7f9; --panel: #fff; --text: #14181f; --muted: #667085; --border: #e2e5ea;
	--accent: #f6821f; --accent-text: #fff; --danger: #c62828; --bar: #f6821f; --bar-bg: #fdeede;
}
@media (prefers-color-scheme: dark) {
	:root {
		--bg: #0f1216; --panel: #181c22; --text: #e8eaee; --muted: #9aa3b0; --border: #2a3039;
		--accent: #f6821f; --accent-text: #14181f; --danger: #ef6a6a; --bar: #f6821f; --bar-bg: #2a2118;
	}
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; }
header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
h1 { font-size: 22px; margin: 0; }
.muted { color: var(--muted); font-size: 13px; }
.tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
.tabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: none; padding: 8px 14px; color: var(--muted); font-weight: 600; }
.tabs button[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
form.add { display: grid; grid-template-columns: 200px 1fr auto; gap: 10px; align-items: end; }
label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
input, select { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button { padding: 8px 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--text); font: inherit; cursor: pointer; }
button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
button.link { border: 0; background: none; padding: 2px 6px; color: var(--accent); }
button.danger { color: var(--danger); }
button:disabled { opacity: .5; cursor: default; }
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
.toolbar input { max-width: 280px; }
.toolbar .spacer { flex: 1; }
.toolbar select { width: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.dest { max-width: 340px; overflow-wrap: anywhere; color: var(--muted); font-size: 13px; }
td.slug { font-weight: 600; overflow-wrap: anywhere; }
td.actions { white-space: nowrap; text-align: right; }
.notice { padding: 10px 12px; border-radius: 8px; background: var(--bar-bg); border: 1px solid var(--border); margin-bottom: 12px; font-size: 14px; }
.notice.error { color: var(--danger); }
.hidden { display: none; }
dialog { border: 1px solid var(--border); border-radius: 12px; background: var(--panel); color: var(--text); width: min(680px, 94vw); padding: 20px; }
dialog::backdrop { background: rgba(0,0,0,.5); }
.dhead { display: flex; justify-content: space-between; align-items: start; gap: 12px; margin-bottom: 12px; }
.dhead h2 { margin: 0; font-size: 18px; overflow-wrap: anywhere; }
.chart { display: flex; align-items: flex-end; gap: 2px; height: 120px; padding: 4px 0; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.chart .bar { flex: 1; min-width: 2px; background: var(--bar); border-radius: 2px 2px 0 0; min-height: 1px; }
.chart .bar.zero { background: var(--bar-bg); }
.axis { display: flex; justify-content: space-between; font-size: 12px; color: var(--muted); margin-bottom: 16px; }
.breakdowns { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
.breakdowns h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 6px; }
.breakdowns ul { list-style: none; margin: 0; padding: 0; }
.breakdowns li { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; font-size: 14px; }
.breakdowns li span:first-child { overflow-wrap: anywhere; }
@media (max-width: 640px) {
	form.add { grid-template-columns: 1fr; }
	th.hide-sm, td.hide-sm { display: none; }
	td.dest { max-width: 160px; }
}
</style>
</head>
<body>
<main>
	<header>
		<h1>Short links</h1>
		<span class="muted" id="who"></span>
	</header>

	<nav class="tabs" role="tablist" aria-label="Collections">
		<button type="button" role="tab" id="tabLinks" aria-selected="true">Links</button>
		<button type="button" role="tab" id="tabDomains" aria-selected="false">Subdomains</button>
	</nav>

	<div id="notice" class="notice hidden" role="status"></div>

	<section class="panel">
		<form class="add" id="addForm" autocomplete="off">
			<div>
				<label for="slug" id="nameLabel">Short name</label>
				<input id="slug" name="slug" placeholder="my-link" required maxlength="96">
			</div>
			<div>
				<label for="url">Destination URL</label>
				<input id="url" name="url" type="url" placeholder="https://example.com/some/long/page" required maxlength="2048">
			</div>
			<button class="primary" type="submit" id="addBtn">Add link</button>
		</form>
		<div class="muted" style="margin-top:8px">Changes can take up to a minute to reach every Cloudflare location (KV is eventually consistent).</div>
		<div class="muted hidden" id="domainNote" style="margin-top:6px">A subdomain only works once it is routed to this Worker: add it as a custom domain route in wrangler.toml (or the Cloudflare dashboard). This page only manages where it redirects.</div>
	</section>

	<section class="panel">
		<div class="toolbar">
			<input id="search" type="search" placeholder="Search" aria-label="Search">
			<span class="spacer"></span>
			<label for="days" style="margin:0">Stats window</label>
			<select id="days">
				<option value="7">7 days</option>
				<option value="30" selected>30 days</option>
				<option value="90">90 days</option>
			</select>
		</div>
		<div id="statsNotice" class="notice hidden"></div>
		<table>
			<thead>
				<tr>
					<th id="colName">Link</th>
					<th>Destination</th>
					<th class="num">Clicks</th>
					<th class="hide-sm">Last click</th>
					<th></th>
				</tr>
			</thead>
			<tbody id="rows"></tbody>
		</table>
		<div id="empty" class="muted hidden" style="padding:12px 8px">No links yet.</div>
		<div id="miss" class="muted hidden" style="padding:12px 8px 0"></div>
	</section>
</main>

<dialog id="detail">
	<div class="dhead">
		<div>
			<h2 id="detailTitle"></h2>
			<div class="muted" id="detailSub"></div>
		</div>
		<button type="button" id="detailClose">Close</button>
	</div>
	<div id="detailBody"></div>
</dialog>

<dialog id="editDialog">
	<form method="dialog" id="editForm">
		<div class="dhead"><h2 id="editTitle"></h2></div>
		<label for="editUrl">Destination URL</label>
		<input id="editUrl" type="url" required maxlength="2048">
		<div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px">
			<button type="button" id="editCancel">Cancel</button>
			<button class="primary" type="submit">Save</button>
		</div>
	</form>
</dialog>

<script>
(function () {
	// Per-tab settings. "key" is the JSON field name the API expects for the entry's name.
	var TABS = {
		links: { path: "/api/links", key: "slug", kind: "link", noun: "link", column: "Link", label: "Short name", placeholder: "my-link", maxlength: 96, add: "Add link" },
		domains: { path: "/api/domains", key: "name", kind: "domain", noun: "subdomain", column: "Subdomain", label: "Subdomain", placeholder: "docs", maxlength: 63, add: "Add subdomain" }
	};
	var state = { tab: "links", links: [], domains: [], unresolved: { links: 0, domains: 0 }, clicks: {}, miss: 0, config: null, statsError: null, editing: null };
	var $ = function (id) { return document.getElementById(id); };
	var tab = function () { return TABS[state.tab]; };

	function api(method, path, body) {
		var opts = { method: method, headers: { "X-Requested-With": "shortlinks-admin" } };
		if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
		return fetch(path, opts).then(function (res) {
			return res.json().catch(function () { return {}; }).then(function (data) {
				if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
				return data;
			});
		});
	}

	function notify(message, isError) {
		var el = $("notice");
		el.textContent = message;
		el.className = "notice" + (isError ? " error" : "");
		if (!isError) setTimeout(function () { el.className = "notice hidden"; }, 4000);
	}

	function fmtDate(value) {
		if (!value) return "-";
		var d = new Date(value.indexOf("T") === -1 ? value.replace(" ", "T") + "Z" : value);
		return isNaN(d) ? "-" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
	}

	function clickKey(kind, name) { return kind + ":" + name; }

	function load() {
		var days = $("days").value;
		var listsP = Promise.all([api("GET", "/api/links"), api("GET", "/api/domains")]).then(function (r) {
			state.links = r[0].links; state.domains = r[1].links;
			state.unresolved = { links: r[0].unresolved, domains: r[1].unresolved };
		});
		var statsP = state.config && state.config.statsEnabled
			? api("GET", "/api/stats?days=" + days).then(function (d) {
				state.clicks = {}; state.miss = 0;
				d.rows.forEach(function (r) {
					if (r.kind === "miss") { state.miss += r.clicks; return; }
					var k = clickKey(r.kind, r.slug);
					var cur = state.clicks[k] || { clicks: 0, last: null };
					cur.clicks += r.clicks;
					if (!cur.last || r.lastClick > cur.last) cur.last = r.lastClick;
					state.clicks[k] = cur;
				});
				state.statsError = null;
			}).catch(function (e) { state.statsError = e.message; })
			: Promise.resolve();
		return Promise.all([listsP, statsP]).then(render).catch(function (e) { notify(e.message, true); });
	}

	function cell(tag, className, text) {
		var el = document.createElement(tag);
		if (className) el.className = className;
		if (text !== undefined) el.textContent = text;
		return el;
	}

	function actionButton(label, className, handler) {
		var b = cell("button", "link " + (className || ""), label);
		b.type = "button";
		b.addEventListener("click", handler);
		return b;
	}

	function setTab(name) {
		state.tab = name;
		var t = tab();
		$("tabLinks").setAttribute("aria-selected", String(name === "links"));
		$("tabDomains").setAttribute("aria-selected", String(name === "domains"));
		$("nameLabel").textContent = t.label;
		$("slug").placeholder = t.placeholder;
		$("slug").maxLength = t.maxlength;
		$("addBtn").textContent = t.add;
		$("colName").textContent = t.column;
		$("domainNote").className = "muted" + (name === "domains" ? "" : " hidden");
		$("addForm").reset();
		$("search").value = "";
		render();
	}

	function render() {
		var t = tab();
		var q = $("search").value.trim().toLowerCase();
		var tbody = $("rows");
		tbody.textContent = "";
		var all = state.tab === "links" ? state.links : state.domains;
		var shown = all.filter(function (l) {
			return !q || l.slug.toLowerCase().indexOf(q) !== -1 || (l.url || "").toLowerCase().indexOf(q) !== -1;
		}).map(function (l) {
			var c = state.clicks[clickKey(t.kind, l.slug)];
			return { link: l, clicks: c ? c.clicks : 0, last: c ? c.last : null };
		}).sort(function (a, b) { return b.clicks - a.clicks || a.link.slug.localeCompare(b.link.slug); });

		var statsOn = state.config && state.config.statsEnabled;
		shown.forEach(function (row) {
			var l = row.link;
			var tr = document.createElement("tr");
			tr.appendChild(cell("td", "slug", state.tab === "links" && l.slug === "default" ? "default (fallback)" : l.slug));
			tr.appendChild(cell("td", "dest", l.url === null ? "(not loaded, edit to set)" : l.url));
			tr.appendChild(cell("td", "num", statsOn ? String(row.clicks) : "-"));
			tr.appendChild(cell("td", "hide-sm", fmtDate(row.last)));
			var actions = cell("td", "actions");
			actions.appendChild(actionButton("Copy", "", function () { copy(l.slug); }));
			if (statsOn) actions.appendChild(actionButton("Stats", "", function () { openDetail(l.slug); }));
			actions.appendChild(actionButton("Edit", "", function () { openEdit(l); }));
			actions.appendChild(actionButton("Delete", "danger", function () { remove(l.slug); }));
			tr.appendChild(actions);
			tbody.appendChild(tr);
		});

		$("empty").className = shown.length ? "muted hidden" : "muted";
		$("empty").textContent = all.length ? "No matches for your search." : "No " + t.noun + "s yet.";

		var statsNotice = $("statsNotice");
		var unresolved = state.unresolved[state.tab];
		if (state.config && !state.config.statsEnabled) {
			statsNotice.textContent = "Click statistics are not configured yet. Set CF_ACCOUNT_ID, CF_API_TOKEN and ANALYTICS_DATASET (see the README).";
			statsNotice.className = "notice";
		} else if (state.statsError) {
			statsNotice.textContent = "Could not load stats: " + state.statsError;
			statsNotice.className = "notice error";
		} else if (unresolved > 0) {
			statsNotice.textContent = unresolved + " older entries are not shown with their destination yet. Editing one stores it in the new format.";
			statsNotice.className = "notice";
		} else {
			statsNotice.className = "notice hidden";
		}

		var miss = $("miss");
		if (state.miss) { miss.textContent = state.miss + " clicks in this window did not match any link or subdomain and went to the default destination."; miss.className = "muted"; }
		else miss.className = "muted hidden";
	}

	function shortUrl(name) {
		if (state.tab === "domains") return "https://" + name + "." + state.config.baseHostname;
		return name === "default" ? state.config.shortBase + "/" : state.config.shortBase + "/" + name;
	}

	function copy(name) {
		var text = shortUrl(name);
		navigator.clipboard.writeText(text).then(function () { notify("Copied " + text); }, function () { notify("Could not copy. " + text, true); });
	}

	function remove(name) {
		var t = tab();
		var warning = state.tab === "domains"
			? "Delete " + name + "? Visitors to this subdomain will be sent to the default page."
			: "Delete " + name + "? Anyone using this short link will be sent to the default page.";
		if (!confirm(warning)) return;
		api("DELETE", t.path + "?" + t.key + "=" + encodeURIComponent(name)).then(function () { notify("Deleted " + name); return load(); })
			.catch(function (e) { notify(e.message, true); });
	}

	function openEdit(link) {
		state.editing = link;
		$("editTitle").textContent = "Edit " + link.slug;
		$("editUrl").value = link.url || "";
		$("editDialog").showModal();
		$("editUrl").focus();
	}

	function openDetail(name) {
		var t = tab();
		var days = $("days").value;
		$("detailTitle").textContent = state.tab === "domains" ? name + "." + state.config.baseHostname : name;
		$("detailSub").textContent = "Last " + days + " days";
		var body = $("detailBody");
		body.textContent = "Loading...";
		$("detail").showModal();
		api("GET", "/api/stats/detail?slug=" + encodeURIComponent(name) + "&kind=" + t.kind + "&days=" + days).then(function (d) {
			body.textContent = "";
			var total = d.daily.reduce(function (n, r) { return n + r.clicks; }, 0);
			$("detailSub").textContent = total + " clicks in the last " + d.days + " days";

			var byDay = {};
			d.daily.forEach(function (r) { byDay[String(r.day).slice(0, 10)] = r.clicks; });
			var chart = cell("div", "chart");
			var max = 1, series = [];
			for (var i = d.days - 1; i >= 0; i--) {
				var date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
				var v = byDay[date] || 0;
				series.push({ date: date, v: v });
				if (v > max) max = v;
			}
			series.forEach(function (s) {
				var bar = cell("div", "bar" + (s.v ? "" : " zero"));
				bar.style.height = (s.v ? Math.max(3, Math.round(s.v / max * 100)) : 1) + "%";
				bar.title = s.date + ": " + s.v;
				chart.appendChild(bar);
			});
			body.appendChild(chart);
			var axis = cell("div", "axis");
			axis.appendChild(cell("span", "", series[0].date));
			axis.appendChild(cell("span", "", "peak " + max + "/day"));
			axis.appendChild(cell("span", "", series[series.length - 1].date));
			body.appendChild(axis);

			var grid = cell("div", "breakdowns");
			[["Referrers", d.referrers], ["Countries", d.countries], ["Devices", d.devices]].forEach(function (pair) {
				var box = document.createElement("div");
				box.appendChild(cell("h3", "", pair[0]));
				var ul = document.createElement("ul");
				if (!pair[1].length) ul.appendChild(cell("li", "muted", "No data"));
				pair[1].forEach(function (r) {
					var li = document.createElement("li");
					li.appendChild(cell("span", "", r.label || "(unknown)"));
					li.appendChild(cell("span", "muted", String(r.clicks)));
					ul.appendChild(li);
				});
				box.appendChild(ul);
				grid.appendChild(box);
			});
			body.appendChild(grid);
		}).catch(function (e) { body.textContent = e.message; });
	}

	$("addForm").addEventListener("submit", function (ev) {
		ev.preventDefault();
		var t = tab();
		var btn = $("addBtn");
		var payload = { url: $("url").value };
		payload[t.key] = $("slug").value;
		btn.disabled = true;
		api("POST", t.path, payload).then(function (r) {
			notify("Added " + r.slug);
			$("addForm").reset();
			return load();
		}).catch(function (e) { notify(e.message, true); }).then(function () { btn.disabled = false; });
	});

	$("editForm").addEventListener("submit", function (ev) {
		ev.preventDefault();
		var t = tab();
		var link = state.editing;
		var payload = { url: $("editUrl").value };
		payload[t.key] = link.slug;
		api("PUT", t.path, payload).then(function () {
			$("editDialog").close();
			notify("Saved " + link.slug);
			return load();
		}).catch(function (e) { notify(e.message, true); });
	});

	$("tabLinks").addEventListener("click", function () { setTab("links"); });
	$("tabDomains").addEventListener("click", function () { setTab("domains"); });
	$("editCancel").addEventListener("click", function () { $("editDialog").close(); });
	$("detailClose").addEventListener("click", function () { $("detail").close(); });
	$("search").addEventListener("input", render);
	$("days").addEventListener("change", load);

	api("GET", "/api/config").then(function (cfg) {
		state.config = cfg;
		$("who").textContent = "Signed in as " + cfg.user;
		return load();
	}).catch(function (e) { notify(e.message, true); });
})();
</script>
</body>
</html>`;

export function renderUi() {
	return PAGE;
}
